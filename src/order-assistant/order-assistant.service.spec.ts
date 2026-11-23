import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { Prisma } from '@generated/client';
import { StaffRole, UserRole, UserType } from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { OrderAssistantService } from './order-assistant.service';
import { SttClient } from './stt.client';
import { VoiceSampleService } from './voice-sample.service';
import {
  FEEDBACK_SOURCE,
  ORDER_ASSISTANT_DISABLED,
} from './order-assistant.constants';

const STORE = '11111111-1111-4111-8111-111111111111';
const WAREHOUSE = '33333333-3333-4333-8333-333333333333';
const FOREIGN_WAREHOUSE = '44444444-4444-4444-8444-444444444444';
const VARIANT = '55555555-5555-4555-8555-555555555555';
const SAMPLE = '66666666-6666-4666-8666-666666666666';

function makeSeller(): CurrentUser {
  return {
    id: 'seller-user',
    role: UserRole.USER,
    type: UserType.STAFF,
    staff: {
      id: 'seller-staff',
      storeId: STORE,
      role: StaffRole.SELLER,
      warehouse: [{ warehouseId: WAREHOUSE }],
    },
  } as unknown as CurrentUser;
}

function catalogueRow(id: string, name: string, value: string, stock = 10) {
  return {
    id,
    sku: `${name}-${value}`.toUpperCase(),
    barCode: null,
    price: new Prisma.Decimal('52000'),
    product: { id: `p-${name}`, name, brand: null },
    inventory: [{ quantity: stock }],
    attributes: [
      {
        value: {
          valueString: value,
          valueNumber: null,
          valueBool: null,
          attribute: { name: 'Шифер', nameUz: 'Shifer', nameEn: 'Slate' },
        },
      },
    ],
  };
}

describe('OrderAssistantService', () => {
  let service: OrderAssistantService;
  const tx = {
    voiceAlias: { upsert: jest.fn(), updateMany: jest.fn() },
  };
  const prisma = {
    store: { findUnique: jest.fn() },
    warehouse: { findFirst: jest.fn(), findUniqueOrThrow: jest.fn() },
    productVariant: { findMany: jest.fn() },
    voiceAlias: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const stt = { transcribe: jest.fn() };
  const samples = { save: jest.fn(), label: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.store.findUnique.mockResolvedValue({
      id: STORE,
      orderAssistantEnabled: true,
      voiceDataConsent: false,
    });
    prisma.voiceAlias.findMany.mockResolvedValue([]);
    samples.save.mockResolvedValue(SAMPLE);
    samples.label.mockResolvedValue(1);
    prisma.$transaction.mockImplementation((cb: (t: typeof tx) => unknown) =>
      cb(tx),
    );
    tx.voiceAlias.updateMany.mockResolvedValue({ count: 0 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderAssistantService,
        { provide: PrismaService, useValue: prisma },
        { provide: SttClient, useValue: stt },
        { provide: VoiceSampleService, useValue: samples },
        {
          provide: getLoggerToken(OrderAssistantService.name),
          useValue: logger,
        },
      ],
    }).compile();
    service = module.get(OrderAssistantService);
  });

  describe('match', () => {
    it('matches against the sellable catalogue of the store warehouse', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        catalogueRow('v1', 'shiferlar', 'Кувасой'),
        catalogueRow('v2', 'shiferlar', 'Бектемир'),
      ]);

      const result = await service.match(
        { warehouseId: WAREHOUSE, text: 'shifer quvasoy' },
        makeSeller(),
      );

      expect(prisma.productVariant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            storeId: STORE,
            warehouseId: WAREHOUSE,
            canSell: true,
            product: { isArchived: false },
          },
        }),
      );
      expect(result.lines).toEqual([
        expect.objectContaining({
          phrase: 'shifer quvasoy',
          status: 'MATCHED',
          candidates: [
            expect.objectContaining({
              variantId: 'v1',
              price: '52000',
              stock: 10,
              attributes: [
                {
                  name: 'Шифер',
                  nameUz: 'Shifer',
                  nameEn: 'Slate',
                  value: 'Кувасой',
                },
              ],
            }),
            expect.objectContaining({ variantId: 'v2' }),
          ],
        }),
      ]);
      // Stats only, never the text
      expect(JSON.stringify(logger.info.mock.calls)).not.toContain('quvasoy');
    });

    it('rejects a warehouse the seller has no access to (403)', async () => {
      await expect(
        service.match(
          { warehouseId: FOREIGN_WAREHOUSE, text: 'shifer' },
          makeSeller(),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
    });

    it('rejects a store without the assistant switched on (403 ORDER_ASSISTANT_DISABLED)', async () => {
      prisma.store.findUnique.mockResolvedValue({
        id: STORE,
        orderAssistantEnabled: false,
      });

      await expect(
        service.match({ warehouseId: WAREHOUSE, text: 'shifer' }, makeSeller()),
      ).rejects.toMatchObject({
        response: { code: ORDER_ASSISTANT_DISABLED },
      });
      expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
    });

    it('rejects more than 30 products in one request', async () => {
      prisma.productVariant.findMany.mockResolvedValue([]);
      const text = Array.from({ length: 31 }, (_, i) => `kafel ${i + 1}`).join(
        '\n',
      );

      await expect(
        service.match({ warehouseId: WAREHOUSE, text }, makeSeller()),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('feedback', () => {
    it('rejects a variant outside the store warehouse and writes nothing', async () => {
      prisma.productVariant.findMany.mockResolvedValue([]);

      await expect(
        service.feedback(
          {
            warehouseId: WAREHOUSE,
            choices: [
              {
                phrase: 'taxta',
                variantId: VARIANT,
                source: FEEDBACK_SOURCE.MANUAL,
              },
            ],
          },
          makeSeller(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.productVariant.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [VARIANT] },
          storeId: STORE,
          warehouseId: WAREHOUSE,
          canSell: true,
          product: { isArchived: false },
        },
        select: { id: true },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('learns CHANGED / MANUAL as aliases, only reinforces PICKED / ACCEPTED', async () => {
      prisma.productVariant.findMany.mockResolvedValue([{ id: VARIANT }]);
      tx.voiceAlias.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.feedback(
        {
          warehouseId: WAREHOUSE,
          choices: [
            {
              phrase: 'Taxta',
              variantId: VARIANT,
              source: FEEDBACK_SOURCE.MANUAL,
            },
            {
              phrase: 'strapela',
              variantId: VARIANT,
              source: FEEDBACK_SOURCE.PICKED,
            },
          ],
        },
        makeSeller(),
      );

      expect(tx.voiceAlias.upsert).toHaveBeenCalledTimes(1);
      expect(tx.voiceAlias.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            storeId_phrase_variantId: {
              storeId: STORE,
              phrase: 'tahta',
              variantId: VARIANT,
            },
          },
          create: {
            storeId: STORE,
            phrase: 'tahta',
            variantId: VARIANT,
            createdById: 'seller-staff',
          },
        }),
      );
      expect(tx.voiceAlias.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { storeId: STORE, phrase: 'strapela', variantId: VARIANT },
        }),
      );
      expect(result).toEqual({ learned: 1, reinforced: 1, labeled: 0 });
      expect(samples.label).not.toHaveBeenCalled();
    });

    it('labels the seller own recordings with the corrected text and choices', async () => {
      prisma.productVariant.findMany.mockResolvedValue([{ id: VARIANT }]);

      const result = await service.feedback(
        {
          warehouseId: WAREHOUSE,
          choices: [
            {
              phrase: 'shifer quvasoy',
              variantId: VARIANT,
              source: FEEDBACK_SOURCE.ACCEPTED,
            },
          ],
          samples: [{ sampleId: SAMPLE, transcriptFinal: 'shifer quvasoy' }],
        },
        makeSeller(),
      );

      expect(samples.label).toHaveBeenCalledWith(
        STORE,
        'seller-staff',
        [{ sampleId: SAMPLE, transcriptFinal: 'shifer quvasoy' }],
        [
          {
            phrase: 'shifer quvasoy',
            variantId: VARIANT,
            source: FEEDBACK_SOURCE.ACCEPTED,
          },
        ],
      );
      expect(result.labeled).toBe(1);
    });

    it('rejects feedback when the assistant is off for the store', async () => {
      prisma.store.findUnique.mockResolvedValue({
        id: STORE,
        orderAssistantEnabled: false,
      });

      await expect(
        service.feedback(
          {
            warehouseId: WAREHOUSE,
            choices: [
              {
                phrase: 'taxta',
                variantId: VARIANT,
                source: FEEDBACK_SOURCE.MANUAL,
              },
            ],
          },
          makeSeller(),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('transcribe', () => {
    const audio = (mimetype = 'audio/mp4') =>
      ({
        buffer: Buffer.from('fake-m4a'),
        size: 8,
        mimetype,
        originalname: 'order.m4a',
      }) as Express.Multer.File;

    it('passes the audio to STT and returns the text without storing it', async () => {
      stt.transcribe.mockResolvedValue({
        text: 'shifer quvasoy',
        durationMs: 4200,
      });

      const result = await service.transcribe(
        { warehouseId: WAREHOUSE },
        audio('audio/webm;codecs=opus'),
        makeSeller(),
      );

      expect(result).toEqual({
        text: 'shifer quvasoy',
        durationMs: 4200,
        sampleId: null,
      });
      expect(stt.transcribe).toHaveBeenCalledWith(
        expect.objectContaining({ mimeType: 'audio/webm' }),
      );
      // No consent → nothing kept
      expect(samples.save).not.toHaveBeenCalled();
      // The seller's words never reach the logs
      expect(JSON.stringify(logger.info.mock.calls)).not.toContain('quvasoy');
    });

    it('keeps the recording when the store gave consent', async () => {
      prisma.store.findUnique.mockResolvedValue({
        id: STORE,
        orderAssistantEnabled: true,
        voiceDataConsent: true,
      });
      stt.transcribe.mockResolvedValue({
        text: 'shifer quvasoy',
        durationMs: 4200,
        model: 'medium-uz',
      });

      const result = await service.transcribe(
        { warehouseId: WAREHOUSE },
        audio(),
        makeSeller(),
      );

      expect(samples.save).toHaveBeenCalledWith({
        storeId: STORE,
        warehouseId: WAREHOUSE,
        staffId: 'seller-staff',
        buffer: expect.any(Buffer) as unknown,
        mimeType: 'audio/mp4',
        durationMs: 4200,
        model: 'medium-uz',
        transcript: 'shifer quvasoy',
      });
      expect(result.sampleId).toBe(SAMPLE);
    });

    it('a platform admin never records for a store', async () => {
      prisma.warehouse.findUniqueOrThrow.mockResolvedValue({
        store: {
          id: STORE,
          orderAssistantEnabled: true,
          voiceDataConsent: true,
        },
      });
      stt.transcribe.mockResolvedValue({ text: 'shifer', durationMs: 900 });
      const admin = {
        id: 'admin-user',
        role: UserRole.ADMIN,
        type: UserType.STAFF,
        staff: null,
      } as unknown as CurrentUser;

      const result = await service.transcribe(
        { warehouseId: WAREHOUSE },
        audio(),
        admin,
      );

      expect(result.sampleId).toBeNull();
      expect(samples.save).not.toHaveBeenCalled();
    });

    it('checks the warehouse and the store flag before calling STT', async () => {
      await expect(
        service.transcribe(
          { warehouseId: FOREIGN_WAREHOUSE },
          audio(),
          makeSeller(),
        ),
      ).rejects.toThrow(ForbiddenException);

      prisma.store.findUnique.mockResolvedValue({
        id: STORE,
        orderAssistantEnabled: false,
      });
      await expect(
        service.transcribe({ warehouseId: WAREHOUSE }, audio(), makeSeller()),
      ).rejects.toMatchObject({
        response: { code: ORDER_ASSISTANT_DISABLED },
      });
      expect(stt.transcribe).not.toHaveBeenCalled();
    });

    it('rejects a missing file and a non-audio type', async () => {
      await expect(
        service.transcribe({ warehouseId: WAREHOUSE }, undefined, makeSeller()),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.transcribe(
          { warehouseId: WAREHOUSE },
          audio('application/pdf'),
          makeSeller(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(stt.transcribe).not.toHaveBeenCalled();
    });
  });
});
