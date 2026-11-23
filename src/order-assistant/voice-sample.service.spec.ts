import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getLoggerToken } from 'nestjs-pino';
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { PrismaService } from '@prisma/prisma.service';
import { FEEDBACK_SOURCE } from './order-assistant.constants';
import { VoiceSampleService, voiceConsentUpdate } from './voice-sample.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const SAMPLE = '66666666-6666-4666-8666-666666666666';

type Command = { input: Record<string, unknown> };

describe('VoiceSampleService', () => {
  const prisma = {
    voiceSample: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const send = jest.fn<Promise<unknown>, [Command]>();
  /** Order of storage and DB writes */
  const calls: string[] = [];

  async function build(bucket: string | undefined) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceSampleService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => bucket } },
        { provide: getLoggerToken(VoiceSampleService.name), useValue: logger },
      ],
    }).compile();
    const service = module.get(VoiceSampleService);
    if (bucket) {
      Object.assign(service as unknown as { s3: unknown }, { s3: { send } });
    }

    return service;
  }

  const sample = () => ({
    storeId: STORE,
    warehouseId: 'wh-1',
    staffId: 'staff-1',
    buffer: Buffer.from('m4a'),
    mimeType: 'audio/mp4',
    durationMs: 4200,
    model: 'medium-uz',
    transcript: 'shifer quvasoy',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    calls.length = 0;
    send.mockImplementation((command: Command) => {
      calls.push(command.constructor.name);
      return Promise.resolve({});
    });
    prisma.voiceSample.deleteMany.mockImplementation(() => {
      calls.push('deleteMany');
      return Promise.resolve({ count: 1 });
    });
  });

  it('without a voice bucket nothing is stored', async () => {
    const service = await build(undefined);

    await expect(service.save(sample())).resolves.toBeNull();
    expect(prisma.voiceSample.create).not.toHaveBeenCalled();
  });

  it('uploads the audio under the store prefix, then writes the row', async () => {
    const service = await build('sthm-voice');

    const id = await service.save(sample());

    const put = send.mock.calls[0][0];
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({
      Bucket: 'sthm-voice',
      ContentType: 'audio/mp4',
    });
    expect(String(put.input.Key)).toMatch(
      new RegExp(`^voice/${STORE}/\\d{4}-\\d{2}/${id}\\.m4a$`),
    );
    expect(prisma.voiceSample.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id,
        storeId: STORE,
        staffId: 'staff-1',
        transcript: 'shifer quvasoy',
        bytes: 3,
      }) as unknown,
    });
  });

  it('a failed row removes the uploaded audio; a failed upload writes nothing', async () => {
    const service = await build('sthm-voice');
    prisma.voiceSample.create.mockRejectedValueOnce(new Error('db down'));

    await expect(service.save(sample())).resolves.toBeNull();
    expect(calls).toEqual(['PutObjectCommand', 'DeleteObjectCommand']);

    send.mockRejectedValueOnce(new Error('storage down'));
    await expect(service.save(sample())).resolves.toBeNull();
    expect(prisma.voiceSample.create).toHaveBeenCalledTimes(1);
  });

  it('labels only own samples and appends choices', async () => {
    const service = await build('sthm-voice');
    prisma.voiceSample.findFirst
      .mockResolvedValueOnce({
        id: SAMPLE,
        choices: [{ phrase: 'a', variantId: 'v0', source: 'ACCEPTED' }],
      })
      .mockResolvedValueOnce(null);
    const choice = {
      phrase: 'shifer',
      variantId: 'v1',
      source: FEEDBACK_SOURCE.PICKED,
    };

    const labeled = await service.label(
      STORE,
      'staff-1',
      [
        { sampleId: SAMPLE, transcriptFinal: 'shifer super' },
        { sampleId: 'someone-elses' },
      ],
      [choice],
    );

    expect(labeled).toBe(1);
    expect(prisma.voiceSample.findFirst).toHaveBeenCalledWith({
      where: { id: SAMPLE, storeId: STORE, staffId: 'staff-1' },
      select: { id: true, choices: true },
    });
    expect(prisma.voiceSample.update).toHaveBeenCalledTimes(1);
    expect(prisma.voiceSample.update).toHaveBeenCalledWith({
      where: { id: SAMPLE },
      data: {
        transcriptFinal: 'shifer super',
        choices: [{ phrase: 'a', variantId: 'v0', source: 'ACCEPTED' }, choice],
        labeledAt: expect.any(Date) as unknown,
      },
    });
  });

  it('consent off: audio is deleted before the rows, then the store prefix is swept', async () => {
    const service = await build('sthm-voice');
    prisma.voiceSample.findMany
      .mockResolvedValueOnce([{ id: SAMPLE, audioKey: 'voice/s/a.m4a' }])
      .mockResolvedValueOnce([]);
    send.mockImplementation((command: Command) => {
      calls.push(command.constructor.name);
      return Promise.resolve(
        command instanceof ListObjectsV2Command
          ? { Contents: [{ Key: `voice/${STORE}/orphan.m4a` }] }
          : {},
      );
    });

    await service.deleteStore(STORE);

    expect(prisma.voiceSample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: STORE } }),
    );
    expect(calls).toEqual([
      'DeleteObjectCommand',
      'deleteMany',
      'ListObjectsV2Command',
      'DeleteObjectCommand',
    ]);
    const list = send.mock.calls[1][0];
    expect(list.input.Prefix).toBe(`voice/${STORE}/`);
    expect(send.mock.calls[2][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('a storage failure keeps the rows for the next sweep', async () => {
    const service = await build('sthm-voice');
    prisma.voiceSample.findMany.mockResolvedValue([
      { id: SAMPLE, audioKey: 'voice/s/a.m4a' },
    ]);
    send.mockRejectedValue(new Error('storage down'));

    await service.deleteStore(STORE);

    expect(prisma.voiceSample.deleteMany).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('sweep deletes expired samples and samples of stores without consent', async () => {
    const service = await build('sthm-voice');
    prisma.voiceSample.findMany.mockResolvedValue([]);

    await service.sweep();

    const wheres = prisma.voiceSample.findMany.mock.calls.map(
      ([args]: [{ where: unknown }]) => args.where,
    );
    expect(wheres).toEqual([
      { createdAt: { lt: expect.any(Date) as unknown } },
      { store: { voiceDataConsent: false } },
    ]);
  });
});

describe('voiceConsentUpdate', () => {
  it('records who switched consent and flags a withdrawal', () => {
    expect(voiceConsentUpdate(false, undefined, 'u')).toEqual({
      data: {},
      revoked: false,
    });
    expect(voiceConsentUpdate(true, true, 'u')).toEqual({
      data: {},
      revoked: false,
    });
    expect(voiceConsentUpdate(false, true, 'u')).toEqual({
      data: {
        voiceDataConsent: true,
        voiceDataConsentAt: expect.any(Date) as unknown,
        voiceDataConsentById: 'u',
      },
      revoked: false,
    });
    expect(voiceConsentUpdate(true, false, 'u').revoked).toBe(true);
  });
});
