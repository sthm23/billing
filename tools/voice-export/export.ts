/**
 * Voice samples → fine-tuning dataset (docs/voice-order/PLAN.md stage 4–5, DESIGN §7).
 * Run on the server (the data must stay in Uzbekistan — never upload it to a foreign service):
 *
 *   npx tsx tools/voice-export/export.ts <outDir> [--store <storeId>] [--all]
 *
 * Writes <outDir>/audio/<sampleId>.<ext> and <outDir>/metadata.jsonl, one line per sample:
 *   { "audio": "audio/<id>.m4a", "text": "...", "labeled": true, "transcript": "...", "durationMs": …,
 *     "model": "...", "storeId": "...", "createdAt": "..." }
 * `text` is the seller-corrected `transcriptFinal`. Without `--all` only labeled samples are
 * exported; with `--all` unlabeled ones get the raw `transcript` (check them by hand).
 * Only stores that still have `voiceDataConsent` are exported.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@generated/client';

const args = process.argv.slice(2);
const outDir = args.find((a) => !a.startsWith('--'));
const storeIndex = args.indexOf('--store');
const storeId = storeIndex >= 0 ? args[storeIndex + 1] : undefined;
const includeUnlabeled = args.includes('--all');
if (!outDir) {
  console.error(
    'Usage: npx tsx tools/voice-export/export.ts <outDir> [--store <storeId>] [--all]',
  );
  process.exit(1);
}

const bucket = process.env.VOICE_S3_BUCKET_NAME;
if (!bucket) {
  console.error('VOICE_S3_BUCKET_NAME is not set');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const endpoint = process.env.S3_ENDPOINT;
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  ...(endpoint ? { endpoint } : {}),
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
  forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
  requestChecksumCalculation: 'WHEN_REQUIRED',
});

async function main() {
  const samples = await prisma.voiceSample.findMany({
    where: {
      store: { voiceDataConsent: true },
      ...(storeId ? { storeId } : {}),
      ...(includeUnlabeled ? {} : { transcriptFinal: { not: null } }),
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      storeId: true,
      audioKey: true,
      durationMs: true,
      model: true,
      transcript: true,
      transcriptFinal: true,
      createdAt: true,
    },
  });

  mkdirSync(join(outDir!, 'audio'), { recursive: true });
  const metadata = join(outDir!, 'metadata.jsonl');
  writeFileSync(metadata, '');

  let seconds = 0;
  for (const sample of samples) {
    const extension = sample.audioKey.split('.').pop() ?? 'audio';
    const audio = `audio/${sample.id}.${extension}`;
    const object = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: sample.audioKey }),
    );
    writeFileSync(
      join(outDir!, audio),
      await object.Body!.transformToByteArray(),
    );
    appendFileSync(
      metadata,
      JSON.stringify({
        audio,
        text: sample.transcriptFinal ?? sample.transcript,
        labeled: sample.transcriptFinal !== null,
        transcript: sample.transcript,
        durationMs: sample.durationMs,
        model: sample.model,
        storeId: sample.storeId,
        createdAt: sample.createdAt.toISOString(),
      }) + '\n',
    );
    seconds += sample.durationMs / 1000;
  }

  console.log(
    `${samples.length} samples, ${(seconds / 3600).toFixed(2)} h of audio → ${outDir}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
