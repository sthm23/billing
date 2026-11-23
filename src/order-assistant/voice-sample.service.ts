import { randomUUID } from 'node:crypto';
import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@generated/client';
import { PrismaService } from '@prisma/prisma.service';
import { s3ClientConfig } from '@prisma/s3.service';
import {
  VOICE_SAMPLE_EXTENSIONS,
  VOICE_SAMPLES,
  type FeedbackSource,
} from './order-assistant.constants';

export interface NewVoiceSample {
  storeId: string;
  warehouseId: string;
  staffId: string;
  buffer: Buffer;
  mimeType: string;
  durationMs: number;
  model: string | null;
  transcript: string;
}

export interface VoiceSampleLabel {
  sampleId: string;
  /** Seller-corrected text; omitted when the session text can't be tied to this recording */
  transcriptFinal?: string;
}

export interface VoiceSampleChoice {
  phrase: string;
  variantId: string;
  source: FeedbackSource;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `Store` fields for a consent switch by the owner (`PUT /store/:id`) or a platform admin
 * (`PATCH /admin/stores/:id`); `revoked` → `VoiceSampleService.deleteStore` after the update.
 */
export function voiceConsentUpdate(
  current: boolean,
  next: boolean | undefined,
  userId: string,
): { data: Prisma.StoreUpdateInput; revoked: boolean } {
  if (next === undefined || next === current) {
    return { data: {}, revoked: false };
  }

  return {
    data: {
      voiceDataConsent: next,
      voiceDataConsentAt: new Date(),
      voiceDataConsentById: userId,
    },
    revoked: !next,
  };
}

/**
 * Sellers' dictations kept for training the speech model (docs/voice-order/DESIGN.md §7,
 * PLAN stage 4) — only for a store with `voiceDataConsent`. Audio goes to the private voice
 * bucket (`VOICE_S3_BUCKET_NAME`), metadata and labels to `voice_samples`.
 *
 * Saving is best effort: a storage failure never fails the seller's transcription.
 * Deleting is strict: audio first, then the row, so a failed delete is retried by the sweep.
 */
@Injectable()
export class VoiceSampleService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly bucket: string;
  private readonly s3: S3Client | null;
  private timers: NodeJS.Timeout[] = [];
  private warnedNoBucket = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    @InjectPinoLogger(VoiceSampleService.name)
    private readonly logger: PinoLogger,
  ) {
    this.bucket = config.get<string>('VOICE_S3_BUCKET_NAME') ?? '';
    this.s3 = this.bucket ? new S3Client(s3ClientConfig(config)) : null;
  }

  onApplicationBootstrap() {
    const sweep = () => void this.sweep();
    const first = setTimeout(() => {
      sweep();
      const daily = setInterval(sweep, VOICE_SAMPLES.SWEEP_INTERVAL_MS);
      daily.unref();
      this.timers.push(daily);
    }, VOICE_SAMPLES.SWEEP_DELAY_MS);
    first.unref();
    this.timers.push(first);
  }

  onModuleDestroy() {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers = [];
  }

  /** Stores the recording and its raw transcript; returns the sample id, or null when not saved. */
  async save(sample: NewVoiceSample): Promise<string | null> {
    if (!this.s3) {
      if (!this.warnedNoBucket) {
        this.warnedNoBucket = true;
        this.logger.warn(
          'VOICE_S3_BUCKET_NAME is not set: voice samples are not saved',
        );
      }
      return null;
    }

    const id = randomUUID();
    const month = new Date().toISOString().slice(0, 7);
    const extension = VOICE_SAMPLE_EXTENSIONS[sample.mimeType] ?? 'audio';
    const audioKey = `${storePrefix(sample.storeId)}${month}/${id}.${extension}`;
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: audioKey,
          Body: sample.buffer,
          ContentType: sample.mimeType,
          ContentLength: sample.buffer.length,
        }),
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'Voice sample upload failed');
      return null;
    }

    try {
      await this.prisma.voiceSample.create({
        data: {
          id,
          storeId: sample.storeId,
          warehouseId: sample.warehouseId,
          staffId: sample.staffId,
          audioKey,
          mimeType: sample.mimeType,
          bytes: sample.buffer.length,
          durationMs: sample.durationMs,
          model: sample.model,
          transcript: sample.transcript,
        },
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'Voice sample row not saved');
      await this.deleteObject(audioKey).catch(() => undefined);
      return null;
    }

    return id;
  }

  /**
   * Seller's result for their own recordings of one review session (`feedback`):
   * corrected text and the chosen variants (appended — `feedback` comes in chunks).
   * Ids of other sellers / stores, or already deleted samples, are ignored.
   */
  async label(
    storeId: string,
    staffId: string,
    labels: VoiceSampleLabel[],
    choices: VoiceSampleChoice[],
  ): Promise<number> {
    let labeled = 0;
    for (const { sampleId, transcriptFinal } of labels) {
      const sample = await this.prisma.voiceSample.findFirst({
        where: { id: sampleId, storeId, staffId },
        select: { id: true, choices: true },
      });
      if (!sample) continue;

      const previous = Array.isArray(sample.choices) ? sample.choices : [];
      await this.prisma.voiceSample.update({
        where: { id: sample.id },
        data: {
          ...(transcriptFinal === undefined ? {} : { transcriptFinal }),
          choices: [
            ...previous,
            ...choices.map((c) => ({ ...c })),
          ] as Prisma.InputJsonValue,
          labeledAt: new Date(),
        },
      });
      labeled++;
    }

    return labeled;
  }

  /**
   * Consent turned off: every sample of the store goes — rows with their audio, then
   * whatever is left under the store's prefix. The sweep finishes it if storage fails.
   */
  async deleteStore(storeId: string): Promise<void> {
    try {
      const deleted = await this.deleteWhere({ storeId });
      if (this.s3) await this.deletePrefix(storePrefix(storeId));
      this.logger.info(
        { storeId, deleted },
        'Voice samples deleted (no consent)',
      );
    } catch (error) {
      // Consent is already off: the daily sweep deletes what is left
      this.logger.error({ storeId, err: error }, 'Voice sample delete failed');
    }
  }

  /** Daily: samples past retention and samples of stores without consent. */
  async sweep(): Promise<void> {
    try {
      const cutoff = new Date(
        Date.now() - VOICE_SAMPLES.RETENTION_DAYS * DAY_MS,
      );
      const expired = await this.deleteWhere({ createdAt: { lt: cutoff } });
      const revoked = await this.deleteWhere({
        store: { voiceDataConsent: false },
      });
      if (expired + revoked > 0) {
        this.logger.info({ expired, revoked }, 'Voice samples swept');
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Voice sample sweep failed');
    }
  }

  private async deleteWhere(where: Prisma.VoiceSampleWhereInput) {
    let deleted = 0;
    for (;;) {
      const rows = await this.prisma.voiceSample.findMany({
        where,
        select: { id: true, audioKey: true },
        take: VOICE_SAMPLES.BATCH,
      });
      if (rows.length === 0) return deleted;
      // Without the bucket configured there is no audio this server could have written
      if (this.s3) {
        for (const row of rows) await this.deleteObject(row.audioKey);
      }
      const { count } = await this.prisma.voiceSample.deleteMany({
        where: { id: { in: rows.map((r) => r.id) } },
      });
      deleted += count;
    }
  }

  private async deletePrefix(prefix: string) {
    let token: string | undefined;
    do {
      const page = await this.s3!.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key) await this.deleteObject(object.Key);
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  /** S3 DeleteObject succeeds for a missing key too. */
  private async deleteObject(key: string) {
    await this.s3!.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

function storePrefix(storeId: string) {
  return `${VOICE_SAMPLES.KEY_PREFIX}/${storeId}/`;
}
