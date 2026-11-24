import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@generated/client';
import {
  CashTransactionCategory,
  CashTransactionType,
  PaymentType,
  StaffRole,
  UserRole,
  UserType,
} from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { DashboardService } from './dashboard.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const WAREHOUSE = '22222222-2222-4222-8222-222222222222';

// Local (Asia/Tashkent, UTC+5) midnight of 2026-11-10 and 2026-11-17
const DAY_FROM = '2026-11-09T19:00:00.000Z';
const DAY_TO = '2026-11-10T19:00:00.000Z';
const WEEK_TO = '2026-11-16T19:00:00.000Z';

const staffUser = (role: StaffRole, userRole: UserRole = UserRole.USER) =>
  ({
    id: 'user',
    role: userRole,
    type: UserType.STAFF,
    staff: {
      id: 'staff',
      storeId: STORE,
      role,
      warehouse: [{ warehouseId: WAREHOUSE }],
    },
  }) as unknown as CurrentUser;

const owner = staffUser(StaffRole.OWNER, UserRole.OWNER);

type Rows = Partial<Record<string, unknown[]>>;

describe('DashboardService', () => {
  let service: DashboardService;
  let rows: Rows;
  const queries: Prisma.Sql[] = [];
  const prisma = {
    $queryRaw: jest.fn(),
    cashTransaction: { groupBy: jest.fn() },
    warehouse: { findFirst: jest.fn(), findMany: jest.fn() },
    store: { findUnique: jest.fn() },
    rental: { findMany: jest.fn() },
  };

  /** Routes each raw query by its `/* dashboard:<name> *\/` marker. */
  const answer = (sql: Prisma.Sql) => {
    queries.push(sql);
    const name = /dashboard:(\w+)/.exec(sql.sql)?.[1] ?? '';
    return Promise.resolve(rows[name] ?? []);
  };
  const query = (name: string) =>
    queries.find((q) => q.sql.includes(`dashboard:${name}`))!;

  beforeEach(async () => {
    jest.clearAllMocks();
    queries.length = 0;
    rows = {};
    prisma.$queryRaw.mockImplementation(
      (strings: TemplateStringsArray, ...values: unknown[]) =>
        answer(Prisma.sql(strings, ...values)),
    );
    prisma.cashTransaction.groupBy.mockResolvedValue([]);
    prisma.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    prisma.warehouse.findMany.mockResolvedValue([]);
    prisma.store.findUnique.mockResolvedValue({ rentalEnabled: false });
    prisma.rental.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(DashboardService);
  });

  describe('access and period', () => {
    it.each([StaffRole.MANAGER, StaffRole.SELLER, StaffRole.CASHIER])(
      '%s gets 403',
      async (role) => {
        await expect(
          service.getSummary({ from: DAY_FROM, to: DAY_TO }, staffUser(role)),
        ).rejects.toThrow(ForbiddenException);
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
      },
    );

    it('a platform admin (no store) gets 403', async () => {
      const admin = {
        id: 'admin',
        role: UserRole.ADMIN,
        type: UserType.STAFF,
        staff: null,
      } as unknown as CurrentUser;
      await expect(
        service.getSummary({ from: DAY_FROM, to: DAY_TO }, admin),
      ).rejects.toThrow(ForbiddenException);
    });

    it('a period longer than 31 days is rejected', async () => {
      await expect(
        service.getSummary(
          { from: '2026-10-01T00:00:00.000Z', to: '2026-11-02T00:00:00.000Z' },
          owner,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('31 days are allowed', async () => {
      await expect(
        service.getSummary(
          { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' },
          owner,
        ),
      ).resolves.toBeDefined();
    });

    it('`to` before or equal to `from` is rejected', async () => {
      await expect(
        service.getSummary({ from: DAY_TO, to: DAY_FROM }, owner),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.getSummary({ from: DAY_TO, to: DAY_TO }, owner),
      ).rejects.toThrow(BadRequestException);
    });

    it('a warehouse of another store gets 403', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(null);
      await expect(
        service.getSummary(
          { from: DAY_FROM, to: DAY_TO, warehouseId: WAREHOUSE },
          owner,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.warehouse.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: WAREHOUSE, storeId: STORE },
        }),
      );
    });
  });

  describe('figures', () => {
    it('revenue = sales − returns of the period; profit counts returned cost back', async () => {
      rows = {
        sales: [
          {
            orders: 4,
            sales: new Prisma.Decimal(1000000),
            items: 10n,
            cost: new Prisma.Decimal(600000),
          },
        ],
        returns: [
          {
            count: 1,
            amount: new Prisma.Decimal(300000),
            cost: new Prisma.Decimal(100000),
          },
        ],
      };
      const res = await service.getSummary(
        { from: DAY_FROM, to: WEEK_TO },
        owner,
      );

      expect(res.kpi).toEqual({
        sales: 1000000,
        returns: 300000,
        revenue: 700000,
        cost: 500000,
        profit: 200000,
        margin: 200000 / 700000,
        orders: 4,
        items: 10,
        avgCheck: 250000,
      });
    });

    it('margin is null when revenue is not positive (only returns in the period)', async () => {
      rows = {
        returns: [{ count: 1, amount: '300000', cost: '100000' }],
      };
      const res = await service.getSummary(
        { from: DAY_FROM, to: WEEK_TO },
        owner,
      );

      expect(res.kpi.revenue).toBe(-300000);
      expect(res.kpi.margin).toBeNull();
      expect(res.kpi.avgCheck).toBe(0);
    });

    it('returns are taken by the return date, sales by the sale date, rentals excluded', async () => {
      await service.getSummary({ from: DAY_FROM, to: WEEK_TO }, owner);

      expect(query('returns').sql).toContain('ro."createdAt" >=');
      expect(query('returns').sql).not.toContain('"soldAt"');
      expect(query('sales').sql).toContain('o."soldAt" >=');
      for (const name of ['sales', 'returns', 'chart', 'payments', 'top']) {
        expect(query(name).sql).toContain('NOT EXISTS (SELECT 1 FROM rentals');
        expect(query(name).values).toContain(STORE);
      }
      expect(query('sales').values).toContain(DAY_FROM);
      expect(query('sales').values).toContain(WEEK_TO);
    });

    it('payment methods: sale payments only, every method listed; the rest went on debt', async () => {
      rows = {
        sales: [{ orders: 2, sales: '1000000', items: 2, cost: '0' }],
        payments: [
          { type: PaymentType.CARD, amount: '200000' },
          { type: PaymentType.CASH, amount: '500000' },
        ],
      };
      const res = await service.getSummary(
        { from: DAY_FROM, to: WEEK_TO },
        owner,
      );

      expect(query('payments').sql).toContain("ct.category = 'SALE'");
      expect(res.payments).toEqual({
        byType: [
          { type: PaymentType.CASH, amount: 500000 },
          { type: PaymentType.CARD, amount: 200000 },
          { type: PaymentType.ONLINE, amount: 0 },
          { type: PaymentType.TRANSFER, amount: 0 },
        ],
        received: 700000,
        debtGiven: 300000,
      });
      expect(res.debts.given).toBe(300000);
    });

    it('cash flow: purchase on its own line, repayments are «Погашено»', async () => {
      const sum = (amount: number) => ({
        _sum: { amount: new Prisma.Decimal(amount) },
      });
      prisma.cashTransaction.groupBy.mockResolvedValue([
        {
          type: CashTransactionType.INCOME,
          category: CashTransactionCategory.SALE,
          ...sum(900000),
        },
        {
          type: CashTransactionType.INCOME,
          category: CashTransactionCategory.DEBT_PAYMENT,
          ...sum(100000),
        },
        {
          type: CashTransactionType.EXPENSE,
          category: CashTransactionCategory.SALARY,
          ...sum(300000),
        },
        {
          type: CashTransactionType.EXPENSE,
          category: CashTransactionCategory.RENT,
          ...sum(400000),
        },
        {
          type: CashTransactionType.EXPENSE,
          category: CashTransactionCategory.PURCHASE,
          ...sum(500000),
        },
        {
          type: CashTransactionType.EXPENSE,
          category: CashTransactionCategory.OTHER,
          _sum: { amount: null },
        },
      ]);
      rows = { outstanding: [{ orders: '250000', manual: '50000' }] };
      const res = await service.getSummary(
        { from: DAY_FROM, to: WEEK_TO },
        owner,
      );

      expect(res.cashflow).toEqual({
        income: 1000000,
        expenses: [
          { category: CashTransactionCategory.RENT, amount: 400000 },
          { category: CashTransactionCategory.SALARY, amount: 300000 },
        ],
        expensesTotal: 700000,
        purchase: 500000,
        net: -200000,
      });
      expect(res.debts.repaid).toBe(100000);
      expect(res.debts.outstandingNow).toBe(300000);
      expect(prisma.cashTransaction.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            createdAt: { gte: new Date(DAY_FROM), lt: new Date(WEEK_TO) },
            cashbox: { storeId: STORE },
          },
        }),
      );
    });

    it('top products are mapped with whole amounts', async () => {
      rows = {
        top: [
          {
            productId: 'p1',
            name: 'Strapela',
            amount: '80340000.4',
            quantity: 412n,
          },
        ],
      };
      const res = await service.getSummary(
        { from: DAY_FROM, to: WEEK_TO },
        owner,
      );

      expect(res.topProducts).toEqual([
        { productId: 'p1', name: 'Strapela', amount: 80340000, quantity: 412 },
      ]);
      expect(query('top').values).toContain(5);
    });
  });

  describe('warehouse filter', () => {
    it('narrows orders and cashboxes; no store-wide open debt', async () => {
      const res = await service.getSummary(
        { from: DAY_FROM, to: WEEK_TO, warehouseId: WAREHOUSE },
        owner,
      );

      for (const name of ['sales', 'returns', 'chart', 'payments', 'top']) {
        expect(query(name).sql).toContain('o."warehouseId" =');
        expect(query(name).values).toContain(WAREHOUSE);
      }
      expect(prisma.cashTransaction.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            cashbox: { storeId: STORE, warehouseId: WAREHOUSE },
          }),
        }),
      );
      expect(queries.some((q) => q.sql.includes('dashboard:outstanding'))).toBe(
        false,
      );
      expect(res.debts.outstandingNow).toBeNull();
      expect(res.warehouseId).toBe(WAREHOUSE);
    });

    it('the whole store has no warehouse condition', async () => {
      await service.getSummary({ from: DAY_FROM, to: WEEK_TO }, owner);

      expect(query('sales').sql).not.toContain('"warehouseId"');
    });
  });

  describe('chart', () => {
    it('one day → 24 hourly points in local time', async () => {
      rows = {
        chart: [
          { key: '2026-11-10 09', sales: '150000', orders: 2 },
          { key: '2026-11-10 18', sales: '50000', orders: 1 },
        ],
      };
      const res = await service.getSummary(
        { from: DAY_FROM, to: DAY_TO },
        owner,
      );

      expect(res.period.granularity).toBe('hour');
      expect(query('chart').values).toContain('YYYY-MM-DD HH24');
      expect(res.chart).toHaveLength(24);
      expect(res.chart[0].at).toEqual(new Date(DAY_FROM));
      // 09:00 local = 04:00 UTC
      expect(res.chart[9]).toEqual({
        at: new Date('2026-11-10T04:00:00.000Z'),
        sales: 150000,
        orders: 2,
      });
      expect(res.chart[18].orders).toBe(1);
      expect(res.chart[0].sales).toBe(0);
    });

    it('seven days → 7 daily points, empty days included', async () => {
      rows = {
        chart: [{ key: '2026-11-12', sales: '700000', orders: 3 }],
      };
      const res = await service.getSummary(
        { from: DAY_FROM, to: WEEK_TO },
        owner,
      );

      expect(res.period.granularity).toBe('day');
      expect(query('chart').values).toContain('YYYY-MM-DD');
      expect(res.chart).toHaveLength(7);
      expect(res.chart.map((p) => p.sales)).toEqual([0, 0, 700000, 0, 0, 0, 0]);
      expect(res.chart[2].at).toEqual(new Date('2026-11-11T19:00:00.000Z'));
    });

    it('a period not starting at midnight still covers its last local day', async () => {
      rows = { chart: [{ key: '2026-11-12', sales: '1000', orders: 1 }] };
      const res = await service.getSummary(
        { from: '2026-11-10T05:00:00.000Z', to: '2026-11-12T05:00:00.000Z' },
        owner,
      );

      expect(res.chart.map((p) => p.sales)).toEqual([0, 0, 1000]);
    });
  });

  describe('getTeam', () => {
    const W2 = '33333333-3333-4333-8333-333333333333';
    const W3 = '44444444-4444-4444-8444-444444444444';

    it('is owner only and checks the period', async () => {
      await expect(
        service.getTeam({ from: DAY_FROM, to: DAY_TO }, staffUser(StaffRole.MANAGER)),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.getTeam(
          { from: '2026-10-01T00:00:00.000Z', to: '2026-11-02T00:00:00.000Z' },
          owner,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('staff by sales; warehouses with shares, an idle inactive one hidden', async () => {
      rows = {
        staff: [
          { staffId: 's1', name: 'Алиев К.', sales: '700000', orders: 3 },
          { staffId: 's2', name: 'Каримова Н.', sales: '300000', orders: 1 },
        ],
        warehouses: [
          { warehouseId: W2, sales: '750000', orders: 3 },
          { warehouseId: WAREHOUSE, sales: '250000', orders: 1 },
        ],
      };
      prisma.warehouse.findMany.mockResolvedValue([
        { id: WAREHOUSE, name: 'Склад 1', isActive: true },
        { id: W2, name: 'Склад 2', isActive: false },
        { id: W3, name: 'Старый', isActive: false },
      ]);
      const res = await service.getTeam({ from: DAY_FROM, to: WEEK_TO }, owner);

      expect(res.staff).toEqual([
        { staffId: 's1', name: 'Алиев К.', sales: 700000, orders: 3 },
        { staffId: 's2', name: 'Каримова Н.', sales: 300000, orders: 1 },
      ]);
      expect(res.warehouses).toEqual([
        { warehouseId: W2, name: 'Склад 2', sales: 750000, orders: 3, share: 0.75 },
        { warehouseId: WAREHOUSE, name: 'Склад 1', sales: 250000, orders: 1, share: 0.25 },
      ]);
      expect(prisma.warehouse.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { storeId: STORE } }),
      );
      expect(query('staff').sql).toContain('NOT EXISTS (SELECT 1 FROM rentals');
    });

    it('a store with one warehouse has no warehouse card; shares are 0 without sales', async () => {
      prisma.warehouse.findMany.mockResolvedValue([
        { id: WAREHOUSE, name: 'Склад 1', isActive: true },
      ]);
      expect(
        (await service.getTeam({ from: DAY_FROM, to: WEEK_TO }, owner)).warehouses,
      ).toBeNull();

      prisma.warehouse.findMany.mockResolvedValue([
        { id: WAREHOUSE, name: 'Склад 1', isActive: true },
        { id: W2, name: 'Склад 2', isActive: true },
      ]);
      const res = await service.getTeam({ from: DAY_FROM, to: WEEK_TO }, owner);
      expect(res.warehouses?.map((w) => w.share)).toEqual([0, 0]);
    });

    it('a warehouse filter: staff of that warehouse only, no warehouse card', async () => {
      const res = await service.getTeam(
        { from: DAY_FROM, to: WEEK_TO, warehouseId: WAREHOUSE },
        owner,
      );

      expect(query('staff').values).toContain(WAREHOUSE);
      expect(queries.some((q) => q.sql.includes('dashboard:warehouses'))).toBe(false);
      expect(prisma.warehouse.findMany).not.toHaveBeenCalled();
      expect(res.warehouses).toBeNull();
    });
  });

  describe('getActivity', () => {
    it('is owner only', async () => {
      await expect(
        service.getActivity({ from: DAY_FROM, to: DAY_TO }, staffUser(StaffRole.SELLER)),
      ).rejects.toThrow(ForbiddenException);
    });

    it('hours: average per day of the period, peak and quietest selling hour', async () => {
      rows = {
        hours: [
          { hour: 10, sales: '700000', orders: 5 },
          { hour: 15, sales: '1400000', orders: 7 },
          { hour: 19, sales: '70000', orders: 1 },
        ],
      };
      const res = await service.getActivity({ from: DAY_FROM, to: WEEK_TO }, owner);

      expect(query('hours').sql).toContain('EXTRACT(HOUR FROM');
      expect(res.hours.days).toBe(7);
      expect(res.hours.points).toHaveLength(24);
      expect(res.hours.points[15]).toEqual({ hour: 15, avgSales: 200000, orders: 7 });
      expect(res.hours.points[10].avgSales).toBe(100000);
      expect(res.hours.points[0]).toEqual({ hour: 0, avgSales: 0, orders: 0 });
      expect(res.hours.peakHour).toBe(15);
      expect(res.hours.quietHour).toBe(19);
    });

    it('hours: nothing sold → no peak; one selling hour → no quietest', async () => {
      let res = await service.getActivity({ from: DAY_FROM, to: DAY_TO }, owner);
      expect(res.hours.days).toBe(1);
      expect(res.hours.peakHour).toBeNull();
      expect(res.hours.quietHour).toBeNull();

      rows = { hours: [{ hour: 12, sales: '1000', orders: 1 }] };
      res = await service.getActivity({ from: DAY_FROM, to: DAY_TO }, owner);
      expect(res.hours.peakHour).toBe(12);
      expect(res.hours.quietHour).toBeNull();
    });

    it('returns: share of the period sales, every reason listed', async () => {
      rows = {
        sales: [{ orders: 10, sales: '2000000', items: 10, cost: '0' }],
        returns: [{ count: 3, amount: '100000', cost: '50000' }],
        reasons: [
          { reason: 'NOT_FIT', count: 2, amount: '80000' },
          { reason: 'DEFECT', count: 1, amount: '20000' },
        ],
      };
      const res = await service.getActivity({ from: DAY_FROM, to: WEEK_TO }, owner);

      expect(query('reasons').sql).toContain('ro."createdAt" >=');
      expect(res.returns).toEqual({
        amount: 100000,
        count: 3,
        share: 0.05,
        byReason: [
          { reason: 'DEFECT', count: 1, amount: 20000 },
          { reason: 'NOT_FIT', count: 2, amount: 80000 },
          { reason: 'EXTRA', count: 0, amount: 0 },
          { reason: 'OTHER', count: 0, amount: 0 },
        ],
      });
    });

    it('returns: share is null without sales', async () => {
      rows = { returns: [{ count: 1, amount: '100000', cost: '0' }] };
      const res = await service.getActivity({ from: DAY_FROM, to: WEEK_TO }, owner);

      expect(res.returns.share).toBeNull();
    });

    it('rental is null when the store has rental off', async () => {
      const res = await service.getActivity({ from: DAY_FROM, to: WEEK_TO }, owner);

      expect(res.rental).toBeNull();
      expect(prisma.rental.findMany).not.toHaveBeenCalled();
    });

    describe('rental', () => {
      beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
        // 2026-11-24 15:00 local
        jest.setSystemTime(new Date('2026-11-24T10:00:00.000Z'));
        prisma.store.findUnique.mockResolvedValue({ rentalEnabled: true });
      });
      afterEach(() => jest.useRealTimers());

      const rentalRow = (endDate: string, taken: number[], back: number[]) => ({
        endDate: new Date(endDate),
        order: { items: taken.map((quantity) => ({ quantity })) },
        returns: back.length
          ? [{ items: back.map((quantity) => ({ quantity })) }]
          : [],
      });

      it('income = rental cash in − paid back; units out now, due today, overdue', async () => {
        prisma.cashTransaction.groupBy.mockResolvedValue([
          { type: CashTransactionType.INCOME, _sum: { amount: new Prisma.Decimal(900000) } },
          { type: CashTransactionType.EXPENSE, _sum: { amount: new Prisma.Decimal(150000) } },
        ]);
        prisma.rental.findMany.mockResolvedValue([
          // ends today at noon local (07:00 UTC): due today and already overdue
          rentalRow('2026-11-24T07:00:00.000Z', [2, 1], [1]),
          // ends tomorrow noon
          rentalRow('2026-11-25T07:00:00.000Z', [1], []),
          // ended 3 days ago
          rentalRow('2026-11-21T07:00:00.000Z', [4], []),
        ]);
        const res = await service.getActivity({ from: DAY_FROM, to: WEEK_TO }, owner);

        expect(res.rental).toEqual({ income: 750000, out: 7, dueToday: 2, overdue: 6 });
        expect(prisma.rental.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              storeId: STORE,
              status: { in: ['ISSUED', 'PARTIALLY_RETURNED'] },
            },
          }),
        );
        expect(prisma.cashTransaction.groupBy).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              cashbox: { storeId: STORE },
              order: { rental: { isNot: null } },
            }),
          }),
        );
      });

      it('the warehouse filter narrows rentals and rental cash', async () => {
        await service.getActivity(
          { from: DAY_FROM, to: WEEK_TO, warehouseId: WAREHOUSE },
          owner,
        );

        expect(prisma.rental.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ warehouseId: WAREHOUSE }),
          }),
        );
        expect(prisma.cashTransaction.groupBy).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              cashbox: { storeId: STORE, warehouseId: WAREHOUSE },
            }),
          }),
        );
      });
    });
  });
});
