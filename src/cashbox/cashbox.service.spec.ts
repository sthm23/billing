import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import {
  CashStatus,
  CashTransactionType,
  PaymentType,
  StaffRole,
  UserRole,
  UserType,
} from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { CashboxService } from './cashbox.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const WAREHOUSE = '33333333-3333-4333-8333-333333333333';
const CASHBOX = '88888888-8888-4888-8888-888888888888';

function makeUser(staffRole: StaffRole): CurrentUser {
  return {
    id: 'user',
    role: staffRole === StaffRole.OWNER ? UserRole.OWNER : UserRole.USER,
    type: UserType.STAFF,
    staff: {
      id: 'staff',
      storeId: STORE,
      role: staffRole,
      warehouse: [{ warehouseId: WAREHOUSE }],
    },
  } as unknown as CurrentUser;
}

describe('CashboxService', () => {
  let service: CashboxService;
  const prisma = {
    warehouse: { findFirst: jest.fn() },
    cashbox: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      aggregate: jest.fn(),
      update: jest.fn(),
    },
    cashTransaction: { groupBy: jest.fn() },
  };
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.cashbox.count.mockResolvedValue(0);
    prisma.cashbox.findMany.mockResolvedValue([]);
    prisma.cashbox.aggregate.mockResolvedValue({
      _count: { _all: 2 },
      _sum: { balance: '18056319' },
    });
    prisma.cashTransaction.groupBy.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashboxService,
        { provide: PrismaService, useValue: prisma },
        { provide: getLoggerToken(CashboxService.name), useValue: logger },
      ],
    }).compile();

    service = module.get<CashboxService>(CashboxService);
  });

  describe('findAll', () => {
    it('returns today totals of open cashboxes and the last closing time', async () => {
      const closedAt = new Date('2026-10-20T14:30:00Z');
      prisma.cashbox.findFirst.mockResolvedValue({ closedAt });
      prisma.cashTransaction.groupBy.mockResolvedValue([
        { type: CashTransactionType.INCOME, _sum: { amount: '24500000' } },
        { type: CashTransactionType.EXPENSE, _sum: { amount: '6443681' } },
      ]);
      const from = '2026-10-20T19:00:00.000Z';
      const to = '2026-10-21T19:00:00.000Z';

      const res = await service.findAll(
        { from, to },
        makeUser(StaffRole.OWNER),
      );

      expect(prisma.cashTransaction.groupBy.mock.calls[0][0].where).toEqual({
        cashbox: { storeId: STORE, status: CashStatus.OPEN },
        createdAt: { gte: new Date(from), lt: new Date(to) },
      });
      expect(res.today).toMatchObject({
        openCount: 2,
        balance: 18056319,
        income: 24500000,
        expense: 6443681,
        lastClosedAt: closedAt,
      });
    });

    it('scopes by role: manager — warehouses, seller — own cashboxes', async () => {
      await service.findAll({}, makeUser(StaffRole.MANAGER));
      expect(prisma.cashbox.findMany.mock.calls[0][0].where).toEqual({
        storeId: STORE,
        warehouseId: { in: [WAREHOUSE] },
      });
      await service.findAll({}, makeUser(StaffRole.SELLER));
      expect(prisma.cashbox.findMany.mock.calls[1][0].where).toEqual({
        storeId: STORE,
        sellerId: 'staff',
      });
    });

    it('works for an admin without a staff profile', async () => {
      await service.findAll({}, {
        id: 'admin',
        role: UserRole.ADMIN,
        staff: null,
      } as never);
      expect(prisma.cashbox.findMany.mock.calls[0][0].where).toEqual({});
    });

    it('rejects a user without a staff profile', async () => {
      await expect(
        service.findAll({}, {
          id: 'u',
          role: UserRole.USER,
          staff: null,
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('findOne', () => {
    it('adds income, expense and net per payment method', async () => {
      prisma.cashbox.findFirst.mockResolvedValue({
        id: CASHBOX,
        transactions: [],
      });
      prisma.cashTransaction.groupBy.mockResolvedValue([
        {
          type: CashTransactionType.INCOME,
          paymentType: PaymentType.CASH,
          _sum: { amount: '1000' },
        },
        {
          type: CashTransactionType.EXPENSE,
          paymentType: PaymentType.CASH,
          _sum: { amount: '300' },
        },
        {
          type: CashTransactionType.INCOME,
          paymentType: PaymentType.ONLINE,
          _sum: { amount: '500' },
        },
      ]);

      const res = await service.findOne(CASHBOX, makeUser(StaffRole.SELLER));

      expect(prisma.cashbox.findFirst.mock.calls[0][0].where).toEqual({
        storeId: STORE,
        sellerId: 'staff',
        id: CASHBOX,
      });
      expect(res.summary).toEqual({
        income: 1500,
        expense: 300,
        byMethod: [
          { paymentType: PaymentType.CASH, net: 700 },
          { paymentType: PaymentType.CARD, net: 0 },
          { paymentType: PaymentType.ONLINE, net: 500 },
          { paymentType: PaymentType.TRANSFER, net: 0 },
        ],
      });
    });
  });

  describe('createCashBox', () => {
    const FOREIGN_STORE = '22222222-2222-4222-8222-222222222222';

    it('opens in the store from the token, ignoring storeId and status from the body', async () => {
      prisma.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE, storeId: STORE });
      prisma.cashbox.findFirst.mockResolvedValue(null);
      prisma.cashbox.create.mockResolvedValue({ id: CASHBOX });
      await service.createCashBox(
        { warehouseId: WAREHOUSE, storeId: FOREIGN_STORE, status: CashStatus.CLOSED, balance: 0 },
        makeUser(StaffRole.MANAGER),
      );
      expect(prisma.warehouse.findFirst).toHaveBeenCalledWith({
        where: { id: WAREHOUSE, storeId: STORE },
      });
      expect(prisma.cashbox.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          storeId: STORE,
          status: CashStatus.OPEN,
          sellerId: 'staff',
        }),
      });
    });

    it('rejects a warehouse of another store', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(null);
      await expect(
        service.createCashBox({ warehouseId: WAREHOUSE, balance: 0 }, makeUser(StaffRole.OWNER)),
      ).rejects.toThrow('Warehouse does not belong to the store');
      expect(prisma.cashbox.create).not.toHaveBeenCalled();
    });

    it('rejects a manager outside the warehouse', async () => {
      prisma.warehouse.findFirst.mockResolvedValue({ id: 'other', storeId: STORE });
      await expect(
        service.createCashBox({ warehouseId: 'other', balance: 0 }, makeUser(StaffRole.MANAGER)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.cashbox.create).not.toHaveBeenCalled();
    });
  });

  describe('closeCashBox', () => {
    it('stamps closedAt', async () => {
      prisma.cashbox.findFirst.mockResolvedValue({ id: CASHBOX });
      await service.closeCashBox(CASHBOX, makeUser(StaffRole.SELLER));
      expect(prisma.cashbox.update).toHaveBeenCalledWith({
        where: { id: CASHBOX },
        data: { status: CashStatus.CLOSED, closedAt: expect.any(Date) },
      });
    });
  });
});
