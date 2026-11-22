import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import {
  AttributeType,
  StaffRole,
  StoreStatus,
  StoreSuspendReason,
  UserRole,
  UserType,
} from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { AdminStoresService, isTrialExpired } from './admin-stores.service';
import { CreateAdminStoreDto } from './dto/admin-store.dto';

const STORE = '11111111-1111-4111-8111-111111111111';
const CATEGORY = '22222222-2222-4222-8222-222222222222';
const ATTR = '55555555-5555-4555-8555-555555555555';

const admin = {
  id: 'admin-user',
  role: UserRole.ADMIN,
  type: UserType.STAFF,
  staff: null,
} as unknown as CurrentUser;

function storeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STORE,
    name: 'Ёғоч',
    status: StoreStatus.ACTIVE,
    trialEndsAt: null,
    paidUntil: null,
    suspendedAt: null,
    suspendedById: null,
    suspendReason: null,
    suspendComment: null,
    createdAt: new Date('2026-03-12T00:00:00Z'),
    salesEnabled: true,
    rentalEnabled: false,
    address: null,
    inn: null,
    note: null,
    staff: [
      {
        isActive: true,
        user: {
          id: 'owner-user',
          fullName: 'Тухтамишев Санжар',
          phone: '+998901234567',
          auth: { login: 'sanjar_t', isActive: true },
        },
      },
    ],
    _count: { warehouse: 2, staff: 6 },
    warehouse: [],
    categories: [],
    brands: [],
    attributes: [],
    ...overrides,
  };
}

function createDto(
  overrides: Partial<CreateAdminStoreDto> = {},
): CreateAdminStoreDto {
  return {
    name: 'Baraka Textile',
    categoryId: CATEGORY,
    warehouseName: 'Основной склад',
    owner: {
      fullName: 'Каримова Шахноза',
      phone: '+998934567890',
      login: 'shahnoza.k',
      password: 'Baraka2026',
    },
    brandNames: ['Mango', 'mango', 'Lacoste'],
    attributeIds: [ATTR],
    newAttributes: [{ name: 'Длина', type: AttributeType.NUMBER, unit: 'м' }],
    salesEnabled: true,
    rentalEnabled: false,
    ...overrides,
  } as CreateAdminStoreDto;
}

describe('AdminStoresService', () => {
  let service: AdminStoresService;
  const prisma = {
    store: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    staff: { findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
    user: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    category: { findUnique: jest.fn() },
    attribute: { count: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    brand: { findFirst: jest.fn(), create: jest.fn() },
    warehouse: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.store.findUnique.mockResolvedValue(storeRow());
    prisma.staff.findMany.mockResolvedValue([]);
    prisma.staff.count.mockResolvedValue(0);
    prisma.category.findUnique.mockResolvedValue({
      id: CATEGORY,
      parentId: null,
    });
    prisma.attribute.count.mockResolvedValue(1);
    prisma.attribute.findFirst.mockResolvedValue(null);
    prisma.attribute.create.mockResolvedValue({ id: 'new-attr' });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'owner-user' });
    prisma.brand.findFirst.mockImplementation(
      ({ where }: { where: { name: { equals: string } } }) =>
        Promise.resolve(
          where.name.equals === 'Mango' ? { id: 'brand-mango' } : null,
        ),
    );
    prisma.brand.create.mockResolvedValue({ id: 'brand-new' });
    prisma.store.create.mockResolvedValue({ id: STORE });
    prisma.warehouse.create.mockResolvedValue({ id: 'wh-1' });
    prisma.$transaction.mockImplementation(
      (cb: (tx: typeof prisma) => unknown) => cb(prisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminStoresService,
        { provide: PrismaService, useValue: prisma },
        { provide: getLoggerToken(AdminStoresService.name), useValue: logger },
      ],
    }).compile();

    service = module.get(AdminStoresService);
  });

  describe('list', () => {
    it('filters by search + mode + status and counts statuses before the status filter', async () => {
      prisma.store.findMany.mockResolvedValue([storeRow()]);
      prisma.store.count.mockResolvedValue(1);
      prisma.store.groupBy.mockResolvedValue([
        { status: StoreStatus.ACTIVE, _count: { _all: 31 } },
        { status: StoreStatus.TRIAL, _count: { _all: 7 } },
        { status: StoreStatus.SUSPENDED, _count: { _all: 4 } },
      ]);

      const res = await service.list({
        search: 'Ёғ',
        mode: 'rent',
        status: StoreStatus.ACTIVE,
      });

      const { where } = prisma.store.findMany.mock.calls[0][0];
      expect(where.AND[1]).toEqual({ status: StoreStatus.ACTIVE });
      expect(JSON.stringify(where)).toContain('"rentalEnabled":true');
      expect(prisma.store.groupBy.mock.calls[0][0].where).not.toHaveProperty(
        'AND.1.status',
      );
      expect(res.counts).toEqual({
        total: 42,
        active: 31,
        trial: 7,
        suspended: 4,
      });
      expect(res.data[0]).toMatchObject({
        name: 'Ёғоч',
        owner: { fullName: 'Тухтамишев Санжар', login: 'sanjar_t' },
        warehousesCount: 2,
        staffCount: 6,
        trialExpired: false,
      });
    });
  });

  describe('isTrialExpired', () => {
    it('is true only for TRIAL past trialEndsAt', () => {
      const now = new Date('2026-12-20T00:00:00Z');
      const past = new Date('2026-12-12T00:00:00Z');
      expect(
        isTrialExpired({ status: StoreStatus.TRIAL, trialEndsAt: past }, now),
      ).toBe(true);
      expect(
        isTrialExpired({ status: StoreStatus.ACTIVE, trialEndsAt: past }, now),
      ).toBe(false);
      expect(
        isTrialExpired(
          { status: StoreStatus.TRIAL, trialEndsAt: new Date('2027-01-01') },
          now,
        ),
      ).toBe(false);
    });
  });

  describe('create', () => {
    it('creates owner, TRIAL store, warehouse and owner staff in one transaction', async () => {
      await service.create(createDto(), admin);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({
        role: UserRole.OWNER,
        type: UserType.STAFF,
        auth: { create: { login: 'shahnoza.k' } },
      });
      // password is hashed
      expect(
        prisma.user.create.mock.calls[0][0].data.auth.create.passwordHash,
      ).not.toBe('Baraka2026');

      const storeData = prisma.store.create.mock.calls[0][0].data;
      expect(storeData).toMatchObject({
        name: 'Baraka Textile',
        ownerId: 'owner-user',
        createdBy: 'admin-user',
        status: StoreStatus.TRIAL,
      });
      expect(storeData.trialEndsAt).toBeInstanceOf(Date);
      // Mango reused (case-insensitive duplicate dropped), Lacoste created
      expect(storeData.brands.createMany.data).toEqual([
        { brandId: 'brand-mango' },
        { brandId: 'brand-new' },
      ]);
      expect(prisma.brand.create).toHaveBeenCalledTimes(1);
      expect(storeData.attributes.createMany.data).toEqual([
        { attributeId: ATTR },
        { attributeId: 'new-attr' },
      ]);
      expect(prisma.attribute.create.mock.calls[0][0].data).toEqual({
        name: 'Длина',
        type: AttributeType.NUMBER,
        unit: 'м',
      });
      expect(prisma.staff.create.mock.calls[0][0].data).toMatchObject({
        userId: 'owner-user',
        storeId: STORE,
        role: StaffRole.OWNER,
        warehouse: { create: { warehouseId: 'wh-1' } },
      });
    });

    it('rejects a taken login or phone with 409', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'someone' });

      await expect(service.create(createDto(), admin)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('requires a top-level category and at least one mode', async () => {
      prisma.category.findUnique.mockResolvedValue({
        id: CATEGORY,
        parentId: 'root',
      });
      await expect(service.create(createDto(), admin)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      await expect(
        service.create(
          createDto({ salesEnabled: false, rentalEnabled: false }),
          admin,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reuses an existing attribute only with the same type', async () => {
      prisma.attribute.findFirst.mockResolvedValue({
        id: 'len',
        type: AttributeType.STRING,
      });

      await expect(service.create(createDto(), admin)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('update', () => {
    it('keeps at least one mode enabled', async () => {
      await expect(
        service.update(STORE, { salesEnabled: false }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.store.update).not.toHaveBeenCalled();
    });

    it('renames and toggles modes', async () => {
      await service.update(STORE, { name: 'Ёғоч 2', rentalEnabled: true });

      expect(prisma.store.update).toHaveBeenCalledWith({
        where: { id: STORE },
        data: { name: 'Ёғоч 2', salesEnabled: true, rentalEnabled: true },
      });
    });

    it('404 for an unknown store', async () => {
      prisma.store.findUnique.mockResolvedValue(null);

      await expect(service.update(STORE, { name: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('suspend / resume', () => {
    it('suspends with reason, comment and the admin', async () => {
      await service.suspend(
        STORE,
        { reason: StoreSuspendReason.UNPAID, comment: 'Оплатите до 10.12' },
        admin,
      );

      expect(prisma.store.update.mock.calls[0][0].data).toMatchObject({
        status: StoreStatus.SUSPENDED,
        suspendedById: 'admin-user',
        suspendReason: StoreSuspendReason.UNPAID,
        suspendComment: 'Оплатите до 10.12',
      });
    });

    it('rejects suspending a suspended store', async () => {
      prisma.store.findUnique.mockResolvedValue(
        storeRow({ status: StoreStatus.SUSPENDED }),
      );

      await expect(
        service.suspend(STORE, { reason: StoreSuspendReason.OTHER }, admin),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('resume with paidUntil → ACTIVE and clears the suspension', async () => {
      prisma.store.findUnique.mockResolvedValue(
        storeRow({ status: StoreStatus.SUSPENDED }),
      );
      const paidUntil = new Date(
        Date.now() + 30 * 24 * 3600 * 1000,
      ).toISOString();

      await service.resume(STORE, { paidUntil }, admin);

      expect(prisma.store.update.mock.calls[0][0].data).toMatchObject({
        status: StoreStatus.ACTIVE,
        paidUntil: new Date(paidUntil),
        suspendedAt: null,
        suspendReason: null,
      });
    });

    it('resume without paidUntil during the trial → TRIAL', async () => {
      prisma.store.findUnique.mockResolvedValue(
        storeRow({
          status: StoreStatus.SUSPENDED,
          trialEndsAt: new Date(Date.now() + 5 * 24 * 3600 * 1000),
        }),
      );

      await service.resume(STORE, {}, admin);

      expect(prisma.store.update.mock.calls[0][0].data.status).toBe(
        StoreStatus.TRIAL,
      );
    });

    it('rejects resuming an active store and a past paidUntil', async () => {
      await expect(service.resume(STORE, {}, admin)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      prisma.store.findUnique.mockResolvedValue(
        storeRow({ status: StoreStatus.SUSPENDED }),
      );
      await expect(
        service.resume(STORE, { paidUntil: '2020-01-01' }, admin),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
