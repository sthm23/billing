import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import {
  StaffDeactivationReason,
  StaffRole,
  UserRole,
  UserType,
} from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { StoreStaffService } from './store-staff.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const WH1 = '33333333-3333-4333-8333-333333333331';
const WH2 = '33333333-3333-4333-8333-333333333332';
const OWNER_STAFF = '44444444-4444-4444-8444-444444444440';
const SELLER_STAFF = '44444444-4444-4444-8444-444444444441';

const owner = {
  id: 'owner-user',
  role: UserRole.OWNER,
  type: UserType.STAFF,
  staff: {
    id: OWNER_STAFF,
    storeId: STORE,
    role: StaffRole.OWNER,
    warehouse: [],
  },
} as unknown as CurrentUser;

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: SELLER_STAFF,
    userId: 'seller-user',
    storeId: STORE,
    role: StaffRole.SELLER,
    isActive: true,
    createdAt: new Date('2026-03-01T00:00:00Z'),
    deactivatedAt: null,
    deactivatedById: null,
    deactivationReason: null,
    user: {
      id: 'seller-user',
      fullName: 'Каримова Нодира',
      phone: '+998905551234',
      role: UserRole.USER,
      auth: { login: 'nodira.k' },
    },
    warehouse: [{ warehouse: { id: WH1, name: 'Склад 1' } }],
    ...overrides,
  };
}

const ownerRow = row({
  id: OWNER_STAFF,
  userId: 'owner-user',
  role: StaffRole.OWNER,
  user: {
    id: 'owner-user',
    fullName: 'Тухтамишев Санжар',
    phone: '+998901234567',
    role: UserRole.OWNER,
    auth: { login: 'owner' },
  },
});

describe('StoreStaffService', () => {
  let service: StoreStaffService;
  const prisma = {
    staff: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    warehouse: { count: jest.fn() },
    user: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    authAccount: { update: jest.fn(), updateMany: jest.fn() },
    staffOnWarehouse: { deleteMany: jest.fn(), createMany: jest.fn() },
    refreshSession: { updateMany: jest.fn() },
    order: { aggregate: jest.fn() },
    $transaction: jest.fn(),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.staff.findFirst.mockResolvedValue(row());
    prisma.warehouse.count.mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.length),
    );
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.order.aggregate.mockResolvedValue({
      _count: { _all: 64 },
      _sum: { totalAmount: '18400000' },
    });
    prisma.$transaction.mockImplementation(
      (cb: (tx: typeof prisma) => unknown) => cb(prisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreStaffService,
        { provide: PrismaService, useValue: prisma },
        { provide: getLoggerToken(StoreStaffService.name), useValue: logger },
      ],
    }).compile();

    service = module.get(StoreStaffService);
  });

  describe('list', () => {
    it('scopes to the token store, puts the owner first and counts roles', async () => {
      prisma.staff.findMany.mockResolvedValue([
        row({
          id: 'b',
          isActive: false,
          user: { ...row().user, fullName: 'Ахмедов Жасур' },
        }),
        row({
          id: 'c',
          role: StaffRole.CASHIER,
          user: { ...row().user, fullName: 'Юсупова Дилноза' },
        }),
        ownerRow,
        row(),
      ]);

      const result = await service.list({ role: StaffRole.SELLER }, owner);

      const where = prisma.staff.findMany.mock.calls[0][0].where;
      expect(where.AND[0]).toEqual({ storeId: STORE });
      expect(result.counts).toEqual({
        total: 4,
        active: 3,
        byRole: { OWNER: 1, SELLER: 2, CASHIER: 1 },
      });
      // role filter applies to data only; active sellers before inactive
      expect(result.data.map((s) => s.id)).toEqual([SELLER_STAFF, 'b']);
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          login: 'nodira.k',
          isOwner: false,
          warehouses: [{ id: WH1, name: 'Склад 1' }],
        }),
      );
    });

    it('lists the owner first when no role filter is given', async () => {
      prisma.staff.findMany.mockResolvedValue([row(), ownerRow]);

      const result = await service.list({}, owner);

      expect(result.data[0]).toEqual(
        expect.objectContaining({ id: OWNER_STAFF, isOwner: true }),
      );
    });

    it('filters by a warehouse of the store and keeps the owner', async () => {
      prisma.staff.findMany.mockResolvedValue([]);

      await service.list({ warehouseId: WH1, search: ' 90 555 ' }, owner);

      const where = prisma.staff.findMany.mock.calls[0][0].where;
      expect(where.AND).toContainEqual({
        OR: [
          { warehouse: { some: { warehouseId: WH1 } } },
          { role: StaffRole.OWNER },
        ],
      });
      expect(JSON.stringify(where.AND[1])).toContain(
        '"phone":{"contains":"90555"}',
      );
    });

    it('rejects a warehouse of another store', async () => {
      prisma.warehouse.count.mockResolvedValue(0);

      await expect(service.list({ warehouseId: WH2 }, owner)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.staff.findMany).not.toHaveBeenCalled();
    });

    it('rejects a user without a store', async () => {
      const admin = { ...owner, staff: null } as unknown as CurrentUser;

      await expect(service.list({}, admin)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findOne', () => {
    it('returns the card with sales stats of the employee', async () => {
      const result = await service.findOne(SELLER_STAFF, {}, owner);

      expect(prisma.staff.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SELLER_STAFF, storeId: STORE },
        }),
      );
      const aggWhere = prisma.order.aggregate.mock.calls[0][0].where;
      expect(aggWhere).toEqual(
        expect.objectContaining({ storeId: STORE, cashierId: SELLER_STAFF }),
      );
      expect(result.stats).toEqual(
        expect.objectContaining({ salesTotal: 18400000, ordersCount: 64 }),
      );
      expect(result.deactivatedBy).toBeNull();
    });

    it('hides an employee of another store', async () => {
      prisma.staff.findFirst.mockResolvedValue(null);

      await expect(service.findOne(SELLER_STAFF, {}, owner)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates the fields sent and replaces the warehouses', async () => {
      await service.update(
        SELLER_STAFF,
        {
          phone: '+998917774012',
          role: StaffRole.CASHIER,
          warehouseIds: [WH1, WH2],
        },
        owner,
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'seller-user' },
        data: { fullName: undefined, phone: '+998917774012' },
      });
      expect(prisma.authAccount.update).not.toHaveBeenCalled();
      expect(prisma.staff.update).toHaveBeenCalledWith({
        where: { id: SELLER_STAFF },
        data: { role: StaffRole.CASHIER },
      });
      expect(prisma.staffOnWarehouse.deleteMany).toHaveBeenCalledWith({
        where: { staffId: SELLER_STAFF },
      });
      expect(prisma.staffOnWarehouse.createMany).toHaveBeenCalledWith({
        data: [
          { staffId: SELLER_STAFF, warehouseId: WH1 },
          { staffId: SELLER_STAFF, warehouseId: WH2 },
        ],
      });
    });

    it('rejects the OWNER role', async () => {
      await expect(
        service.update(SELLER_STAFF, { role: StaffRole.OWNER }, owner),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not edit the owner', async () => {
      prisma.staff.findFirst.mockResolvedValue(ownerRow);

      await expect(
        service.update(OWNER_STAFF, { fullName: 'X' }, owner),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a foreign warehouse', async () => {
      prisma.warehouse.count.mockResolvedValue(1);

      await expect(
        service.update(SELLER_STAFF, { warehouseIds: [WH1, WH2] }, owner),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a phone or login taken by another user', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'other-user' });

      await expect(
        service.update(SELLER_STAFF, { login: 'taken' }, owner),
      ).rejects.toThrow(ConflictException);
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: { not: 'seller-user' },
          OR: [{ auth: { login: 'taken' } }],
        },
        select: { id: true },
      });
    });
  });

  describe('deactivate', () => {
    it('closes the login, revokes sessions and records who and why', async () => {
      await service.deactivate(
        SELLER_STAFF,
        { reason: StaffDeactivationReason.LEFT },
        owner,
      );

      expect(prisma.staff.update).toHaveBeenCalledWith({
        where: { id: SELLER_STAFF },
        data: expect.objectContaining({
          isActive: false,
          deactivatedById: 'owner-user',
          deactivationReason: StaffDeactivationReason.LEFT,
          deactivatedAt: expect.any(Date),
        }),
      });
      expect(prisma.authAccount.updateMany).toHaveBeenCalledWith({
        where: { userId: 'seller-user' },
        data: { isActive: false },
      });
      expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'seller-user', isRevoked: false },
        data: { isRevoked: true },
      });
    });

    it('does not deactivate the owner', async () => {
      prisma.staff.findFirst.mockResolvedValue({
        ...ownerRow,
        id: 'other-owner',
      });

      await expect(
        service.deactivate(
          'other-owner',
          { reason: StaffDeactivationReason.OTHER },
          owner,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('does not deactivate yourself', async () => {
      prisma.staff.findFirst.mockResolvedValue(row({ id: OWNER_STAFF }));

      await expect(
        service.deactivate(
          OWNER_STAFF,
          { reason: StaffDeactivationReason.OTHER },
          owner,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an already deactivated employee', async () => {
      prisma.staff.findFirst.mockResolvedValue(row({ isActive: false }));

      await expect(
        service.deactivate(
          SELLER_STAFF,
          { reason: StaffDeactivationReason.LEFT },
          owner,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('activate', () => {
    it('restores the login and clears the deactivation details', async () => {
      prisma.staff.findFirst.mockResolvedValue(
        row({ isActive: false, deactivatedById: 'owner-user' }),
      );

      await service.activate(SELLER_STAFF, owner);

      expect(prisma.staff.update).toHaveBeenCalledWith({
        where: { id: SELLER_STAFF },
        data: {
          isActive: true,
          deactivatedAt: null,
          deactivatedById: null,
          deactivationReason: null,
        },
      });
      expect(prisma.authAccount.updateMany).toHaveBeenCalledWith({
        where: { userId: 'seller-user' },
        data: { isActive: true },
      });
    });

    it('rejects an active employee', async () => {
      await expect(service.activate(SELLER_STAFF, owner)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
