import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import {
  CashStatus,
  CashTransactionCategory,
  OrderStatus,
  PaymentType,
  StaffRole,
  UserRole,
  UserType,
} from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentService } from './payment.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const WAREHOUSE = '33333333-3333-4333-8333-333333333333';
const ORDER = '44444444-4444-4444-8444-444444444444';
const CUSTOMER = '77777777-7777-4777-8777-777777777777';
const OWN_CASHBOX = '88888888-8888-4888-8888-888888888888';
const OTHER_CASHBOX = '99999999-9999-4999-8999-999999999999';

const seller = {
  id: 'user',
  role: UserRole.USER,
  type: UserType.STAFF,
  staff: {
    id: 'staff',
    storeId: STORE,
    role: StaffRole.SELLER,
    warehouse: [{ warehouseId: WAREHOUSE }],
  },
} as unknown as CurrentUser;

function debtOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER,
    storeId: STORE,
    warehouseId: WAREHOUSE,
    customerId: CUSTOMER,
    status: OrderStatus.DEBT,
    totalAmount: 100000,
    returnedAmount: 0,
    paidAmount: 40000,
    isReturned: false,
    payments: [{ amount: 40000 }],
    ...overrides,
  };
}

const payDto = (amount: number, extra: Partial<CreatePaymentDto> = {}) =>
  ({
    orderId: ORDER,
    payments: [{ type: PaymentType.CASH, amount, paidAt: null }],
    ...extra,
  }) as CreatePaymentDto;

describe('PaymentService', () => {
  let service: PaymentService;
  const prisma = {
    $transaction: jest.fn(),
    order: { findUnique: jest.fn(), update: jest.fn() },
    customer: { findUnique: jest.fn() },
    cashbox: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    payment: { create: jest.fn() },
    cashTransaction: { createMany: jest.fn() },
    returnedOrder: { update: jest.fn() },
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
    prisma.order.findUnique.mockResolvedValue(debtOrder());
    prisma.cashbox.findMany.mockResolvedValue([
      { id: OWN_CASHBOX, warehouseId: WAREHOUSE, status: CashStatus.OPEN },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useValue: prisma },
        { provide: getLoggerToken(PaymentService.name), useValue: logger },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
  });

  describe('create (debt repayment of an order)', () => {
    it('keeps the order customer when customerId is omitted and records a debt payment', async () => {
      await service.create(payDto(20000), seller);
      expect(prisma.order.update.mock.calls[0][0].data).toMatchObject({
        status: OrderStatus.DEBT,
        paidAmount: 60000,
        customerId: CUSTOMER,
      });
      expect(
        prisma.cashTransaction.createMany.mock.calls[0][0].data[0],
      ).toMatchObject({
        cashboxId: OWN_CASHBOX,
        category: CashTransactionCategory.DEBT_PAYMENT,
      });
    });

    it('completes the order when the rest is paid', async () => {
      await service.create(payDto(60000), seller);
      expect(prisma.order.update.mock.calls[0][0].data.status).toBe(
        OrderStatus.COMPLETED,
      );
    });

    it('rejects an order of another store', async () => {
      prisma.order.findUnique.mockResolvedValue(
        debtOrder({ storeId: 'foreign-store' }),
      );
      await expect(
        service.create(payDto(20000), seller),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects paying more than the debt', async () => {
      await expect(
        service.create(payDto(70000), seller),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('takes the money into the chosen open cashbox of the store', async () => {
      prisma.cashbox.findFirst.mockResolvedValue({ id: OTHER_CASHBOX });
      await service.create(payDto(20000, { cashboxId: OTHER_CASHBOX }), seller);
      expect(prisma.cashbox.findFirst).toHaveBeenCalledWith({
        where: { id: OTHER_CASHBOX, storeId: STORE, status: CashStatus.OPEN },
      });
      expect(prisma.cashbox.update.mock.calls[0][0].where).toEqual({
        id: OTHER_CASHBOX,
      });
    });

    it('asks to open or choose a cashbox when the employee has none', async () => {
      prisma.cashbox.findMany.mockResolvedValue([]);
      await expect(service.create(payDto(20000), seller)).rejects.toThrow(
        'No open cashbox',
      );
    });
  });
});
