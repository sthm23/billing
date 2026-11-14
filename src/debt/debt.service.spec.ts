import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import {
  CashTransactionCategory,
  DebtStatus,
  PaymentType,
  StaffRole,
  UserRole,
  UserType,
} from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { CreateDebtDto, CreateDebtPaymentDto } from './dto/create-debt.dto';
import { DebtService } from './debt.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const DEBT = '55555555-5555-4555-8555-555555555555';
const CASHBOX = '88888888-8888-4888-8888-888888888888';
const DAY = 24 * 60 * 60 * 1000;

const cashier = {
  id: 'user',
  role: UserRole.USER,
  type: UserType.STAFF,
  staff: {
    id: 'staff',
    storeId: STORE,
    role: StaffRole.CASHIER,
    warehouse: [],
  },
} as unknown as CurrentUser;

const payDto = (amount: number) =>
  ({
    debtId: DEBT,
    payments: [{ type: PaymentType.CASH, amount }],
  }) as CreateDebtPaymentDto;

const person = (fullName: string, phone: string) => ({
  user: { fullName, phone },
});

describe('DebtService', () => {
  let service: DebtService;
  const prisma = {
    $transaction: jest.fn(),
    customerDebt: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    debtPayment: { create: jest.fn() },
    cashTransaction: { create: jest.fn(), aggregate: jest.fn() },
    cashbox: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    order: { findMany: jest.fn() },
    customer: { findUnique: jest.fn(), update: jest.fn() },
  };
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (cb: (tx: typeof prisma) => unknown) => cb(prisma),
    );
    prisma.customerDebt.findUnique.mockResolvedValue({
      id: DEBT,
      storeId: STORE,
      status: DebtStatus.ACTIVE,
      totalAmount: 100000,
      paidAmount: 30000,
    });
    prisma.cashbox.findMany.mockResolvedValue([
      { id: CASHBOX, warehouseId: 'w' },
    ]);
    prisma.debtPayment.create.mockResolvedValue({ id: 'debt-payment' });
    prisma.customerDebt.update.mockResolvedValue({ status: DebtStatus.ACTIVE });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DebtService,
        { provide: PrismaService, useValue: prisma },
        { provide: getLoggerToken(DebtService.name), useValue: logger },
      ],
    }).compile();

    service = module.get<DebtService>(DebtService);
  });

  describe('createCustomerDebt', () => {
    const CUSTOMER = '77777777-7777-4777-8777-777777777777';
    const manager = {
      ...cashier,
      staff: { ...cashier.staff, role: StaffRole.MANAGER },
    } as unknown as CurrentUser;
    const dto = (extra: Partial<CreateDebtDto> = {}) =>
      ({ customerId: CUSTOMER, amount: 2500000, ...extra }) as CreateDebtDto;

    beforeEach(() => {
      prisma.$transaction.mockImplementation((ops: unknown) =>
        Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: typeof prisma) => unknown)(prisma),
      );
      prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER });
      prisma.customerDebt.create.mockImplementation(({ data }) => Promise.resolve({ id: DEBT, ...data }));
      prisma.customer.update.mockResolvedValue({ id: CUSTOMER });
    });

    it('creates the debt in the staff store with no term and links the customer', async () => {
      const debt = await service.createCustomerDebt(
        dto({ createdAt: '2026-09-12T00:00:00.000Z', description: '  накладная №45 ' }),
        manager,
      );
      expect(prisma.customerDebt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          storeId: STORE,
          customerId: CUSTOMER,
          totalAmount: 2500000,
          status: DebtStatus.ACTIVE,
          description: 'накладная №45',
          createdAt: new Date('2026-09-12T00:00:00.000Z'),
          returnedAt: null,
        }),
      });
      expect(prisma.customer.update).toHaveBeenCalledWith({
        where: { id: CUSTOMER },
        data: { stores: { connect: { id: STORE } } },
      });
      expect(debt.id).toBe(DEBT);
    });

    it('keeps the repay-by date', async () => {
      await service.createCustomerDebt(
        dto({ createdAt: '2026-09-12T00:00:00.000Z', returnedAt: '2026-11-28T18:59:59.999Z' }),
        manager,
      );
      expect(prisma.customerDebt.create.mock.calls[0][0].data.returnedAt).toEqual(
        new Date('2026-11-28T18:59:59.999Z'),
      );
    });

    it('rejects another store, future date, term before creation and unknown customer', async () => {
      const other = '22222222-2222-4222-8222-222222222222';
      await expect(service.createCustomerDebt(dto({ storeId: other }), manager)).rejects.toThrow('Wrong StoreId given!');
      await expect(
        service.createCustomerDebt(dto({ createdAt: new Date(Date.now() + 2 * DAY).toISOString() }), manager),
      ).rejects.toThrow('в будущем');
      await expect(
        service.createCustomerDebt(
          dto({ createdAt: '2026-09-12T00:00:00.000Z', returnedAt: '2026-09-10T00:00:00.000Z' }),
          manager,
        ),
      ).rejects.toThrow('раньше даты создания');
      prisma.customer.findUnique.mockResolvedValue(null);
      await expect(service.createCustomerDebt(dto(), manager)).rejects.toThrow('Клиент не найден');
      expect(prisma.customerDebt.create).not.toHaveBeenCalled();
    });

    it('needs storeId from an admin', async () => {
      const admin = { role: UserRole.ADMIN, staff: null } as unknown as CurrentUser;
      await expect(service.createCustomerDebt(dto(), admin)).rejects.toThrow('storeId is required');
      await service.createCustomerDebt(dto({ storeId: STORE }), admin);
      expect(prisma.customerDebt.create.mock.calls[0][0].data.storeId).toBe(STORE);
    });
  });

  describe('createDebtPayment', () => {
    it('lets any employee repay into their open cashbox and links the transaction', async () => {
      await service.createDebtPayment(payDto(20000), cashier);
      expect(prisma.cashTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          cashboxId: CASHBOX,
          category: CashTransactionCategory.DEBT_PAYMENT,
          debtId: 'debt-payment',
        }),
      });
      expect(prisma.customerDebt.update.mock.calls[0][0].data.status).toBe(
        DebtStatus.ACTIVE,
      );
    });

    it('marks the debt PAID when the rest is paid', async () => {
      await service.createDebtPayment(payDto(70000), cashier);
      expect(prisma.customerDebt.update.mock.calls[0][0].data.status).toBe(
        DebtStatus.PAID,
      );
    });

    it('rejects paying more than is left, a paid debt and another store', async () => {
      await expect(
        service.createDebtPayment(payDto(70001), cashier),
      ).rejects.toBeInstanceOf(BadRequestException);

      prisma.customerDebt.findUnique.mockResolvedValue({
        id: DEBT,
        storeId: STORE,
        status: DebtStatus.PAID,
        totalAmount: 100000,
        paidAmount: 100000,
      });
      await expect(
        service.createDebtPayment(payDto(1000), cashier),
      ).rejects.toBeInstanceOf(BadRequestException);

      prisma.customerDebt.findUnique.mockResolvedValue({
        id: DEBT,
        storeId: 'foreign-store',
        status: DebtStatus.ACTIVE,
        totalAmount: 100000,
        paidAmount: 0,
      });
      await expect(
        service.createDebtPayment(payDto(1000), cashier),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('getDebtors', () => {
    beforeEach(() => {
      const now = Date.now();
      prisma.order.findMany.mockResolvedValue([
        {
          customerId: 'c1',
          customer: person('Тухтамишев Санжар', '+998901112233'),
          totalAmount: 12000000,
          returnedAmount: 0,
          paidAmount: 4949700,
          soldAt: new Date(now - 46 * DAY),
          createdAt: new Date(now - 47 * DAY),
          payments: [{ createdAt: new Date(now - 20 * DAY) }],
        },
        {
          customerId: 'c2',
          customer: person('Алиев Камол', '+998905556677'),
          totalAmount: 3000000,
          returnedAmount: 0,
          paidAmount: 0,
          soldAt: new Date(now - 9 * DAY),
          createdAt: new Date(now - 9 * DAY),
          payments: [],
        },
      ]);
      prisma.customerDebt.findMany.mockResolvedValue([
        {
          customerId: 'c2',
          customer: person('Алиев Камол', '+998905556677'),
          totalAmount: 2400000,
          paidAmount: 0,
          createdAt: new Date(now - 29 * DAY),
          returnedAt: new Date(now - DAY),
          payments: [],
        },
      ]);
      prisma.cashTransaction.aggregate.mockResolvedValue({
        _sum: { amount: '4200000' },
      });
    });

    it('groups debts by customer with totals, age and «paid» in the period', async () => {
      const res = await service.getDebtors({}, cashier);
      expect(prisma.order.findMany.mock.calls[0][0].where).toMatchObject({
        storeId: STORE,
        status: 'DEBT',
      });
      expect(res.summary).toMatchObject({
        total: 7050300 + 5400000,
        customers: 2,
        over30: 7050300,
        paidInPeriod: 4200000,
      });
      expect(res.data.map((d) => d.customerId)).toEqual(['c1', 'c2']);
      expect(res.data[1]).toMatchObject({
        total: 5400000,
        ordersCount: 1,
        debtsCount: 1,
        ageDays: 29,
        lastPaymentAt: null,
        overdue: true,
      });
      expect(res.data[1].dueAt).toBeInstanceOf(Date);
      expect(res.data[0]).toMatchObject({ dueAt: null, overdue: false });
    });

    it('counts DEBT orders without a customer as a separate row in the totals', async () => {
      const now = Date.now();
      prisma.order.findMany.mockResolvedValue([
        {
          customerId: null,
          customer: null,
          totalAmount: 65000,
          returnedAmount: 0,
          paidAmount: 60000,
          soldAt: new Date(now - 150 * DAY),
          createdAt: new Date(now - 150 * DAY),
          payments: [],
        },
      ]);
      prisma.customerDebt.findMany.mockResolvedValue([]);
      const res = await service.getDebtors({}, cashier);
      expect(res.summary).toMatchObject({ total: 5000, customers: 0, over30: 5000 });
      expect(res.data).toEqual([]);
      expect(res.unassigned).toMatchObject({ total: 5000, ordersCount: 1, ageDays: 150 });
    });

    it('sorts by date and filters by name or phone', async () => {
      const byDate = await service.getDebtors({ sort: 'date' }, cashier);
      expect(byDate.data[0].customerId).toBe('c1');
      const found = await service.getDebtors({ search: '5556677' }, cashier);
      expect(found.data.map((d) => d.customerId)).toEqual(['c2']);
      expect(found.summary.customers).toBe(2);
    });
  });

  describe('getDebtor', () => {
    it('returns DEBT orders without a customer for customerId null', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      const res = await service.getDebtor(null, cashier);
      expect(prisma.order.findMany.mock.calls[0][0].where).toMatchObject({
        storeId: STORE,
        customerId: null,
      });
      expect(prisma.customerDebt.findMany).not.toHaveBeenCalled();
      expect(res.customer).toBeNull();
    });

    it('lists open debts of the customer, oldest first, with what is left', async () => {
      prisma.customer.findUnique.mockResolvedValue({
        id: 'c2',
        user: { fullName: 'Алиев Камол', phone: '+998905556677' },
      });
      prisma.order.findMany.mockResolvedValue([
        {
          id: 'o1',
          totalAmount: 3000000,
          returnedAmount: 0,
          paidAmount: 1000000,
          soldAt: new Date('2026-10-10'),
          createdAt: new Date('2026-10-10'),
          warehouse: { id: 'w', name: 'Склад 1' },
          payments: [
            {
              id: 'p1',
              amount: 1000000,
              type: PaymentType.CASH,
              createdAt: new Date('2026-10-10'),
              cashier: { user: { fullName: 'Кассир' } },
            },
          ],
        },
      ]);
      prisma.customerDebt.findMany.mockResolvedValue([
        {
          id: 'd1',
          totalAmount: 500000,
          paidAmount: 0,
          description: 'Старый долг',
          createdAt: new Date('2026-09-01'),
          returnedAt: new Date('2999-01-01'),
          payments: [],
        },
      ]);

      const res = await service.getDebtor('c2', cashier);
      expect(res.total).toBe(2500000);
      expect(res.debts.map((d) => [d.kind, d.id, d.remaining])).toEqual([
        ['MANUAL', 'd1', 500000],
        ['ORDER', 'o1', 2000000],
      ]);
      expect(res.debts[0]).toMatchObject({ dueAt: new Date('2999-01-01'), overdue: false });
      expect(res.debts[1]).toMatchObject({ dueAt: null, overdue: false });
      expect(res.debts[1].payments[0]).toMatchObject({
        amount: 1000000,
        createdBy: 'Кассир',
      });
    });
  });
});
