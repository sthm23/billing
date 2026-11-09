import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { Prisma } from '@generated/client';
import {
  CashStatus,
  CashTransactionCategory,
  CashTransactionType,
  PaymentType,
  RentalCleaningStatus,
  StaffRole,
  UserRole,
  UserType,
} from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { CreateRentalCleaningDto } from './dto/rental-cleaning.dto';
import { RentalAvailabilityService } from './rental-availability.service';
import { RentalCleaningService } from './rental-cleaning.service';
import { addLocalDays, rentalBoundary, todayLocalDate } from './rental-days';
import { RentalService } from './rental.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const WAREHOUSE = '33333333-3333-4333-8333-333333333333';
const DRESS = '55555555-5555-4555-8555-555555555555';
const RENTAL = '88888888-8888-4888-8888-888888888888';
const OTHER_RENTAL = '99999999-9999-4999-8999-999999999999';
const CLEANING = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const D = (v: number | string) => new Prisma.Decimal(v);
const START = addLocalDays(todayLocalDate(), 10);

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

const manager = makeUser(StaffRole.MANAGER);
const seller = makeUser(StaffRole.SELLER);

function dto(extra: Partial<CreateRentalCleaningDto> = {}) {
  return {
    warehouseId: WAREHOUSE,
    variantId: DRESS,
    startDate: START,
    days: 1,
    amount: 80000,
    paymentType: PaymentType.CASH,
    comment: '  Oq Tong  ',
    ...extra,
  };
}

/** An order item of a booking on local dates [from, to) */
function booking(id: string, from: string, to: string, quantity = 1) {
  return {
    variantId: DRESS,
    quantity,
    rentalReturnItems: [],
    order: {
      rental: {
        id,
        startDate: rentalBoundary(from),
        endDate: rentalBoundary(to),
      },
    },
  };
}

function cleaningRow(extra: Record<string, unknown> = {}) {
  return {
    id: CLEANING,
    warehouseId: WAREHOUSE,
    variantId: DRESS,
    startDate: rentalBoundary(START),
    endDate: rentalBoundary(addLocalDays(START, 1)),
    days: 1,
    amount: D(80000),
    paymentType: PaymentType.CASH,
    comment: 'Oq Tong',
    status: RentalCleaningStatus.ACTIVE,
    createdBy: 'staff',
    createdAt: new Date(),
    cancelledBy: null,
    cancelledAt: null,
    variant: { sku: 'AU-46', product: { id: 'p', name: 'Aurora' } },
    ...extra,
  };
}

describe('RentalCleaningService', () => {
  let service: RentalCleaningService;

  const prisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    store: { findUnique: jest.fn() },
    warehouse: { findFirst: jest.fn() },
    productVariant: { findFirst: jest.fn() },
    inventory: { findFirst: jest.fn() },
    orderItem: { findMany: jest.fn() },
    rental: { findMany: jest.fn() },
    rentalCleaning: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    cashTransaction: { create: jest.fn() },
    cashbox: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
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
    prisma.store.findUnique.mockResolvedValue({ rentalEnabled: true });
    prisma.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
    prisma.productVariant.findFirst.mockResolvedValue({ canRent: true });
    prisma.inventory.findFirst.mockResolvedValue({ quantity: 1 });
    prisma.orderItem.findMany.mockResolvedValue([]);
    prisma.rentalCleaning.findMany.mockResolvedValue([]);
    prisma.rental.findMany.mockResolvedValue([]);
    prisma.cashbox.findMany.mockResolvedValue([
      { id: 'own-cashbox', warehouseId: WAREHOUSE, status: CashStatus.OPEN },
    ]);
    prisma.cashTransaction.create.mockResolvedValue({ id: 'tx' });
    prisma.rentalCleaning.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(cleaningRow(data)),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RentalCleaningService,
        RentalService,
        RentalAvailabilityService,
        { provide: PrismaService, useValue: prisma },
        { provide: getLoggerToken(RentalService.name), useValue: logger },
        {
          provide: getLoggerToken(RentalCleaningService.name),
          useValue: logger,
        },
      ],
    }).compile();
    service = module.get(RentalCleaningService);
  });

  describe('create', () => {
    it('blocks one unit from noon of the first day to noon after the last and writes the expense', async () => {
      const row = await service.create(dto({ days: 3 }), manager);

      expect(prisma.$queryRaw).toHaveBeenCalled(); // inventory row lock
      expect(prisma.cashTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          cashboxId: 'own-cashbox',
          type: CashTransactionType.EXPENSE,
          category: CashTransactionCategory.DRY_CLEANING,
          paymentType: PaymentType.CASH,
          amount: D(80000),
          comment: 'Oq Tong',
        }),
        select: { id: true },
      });
      expect(prisma.cashbox.update).toHaveBeenCalledWith({
        where: { id: 'own-cashbox' },
        data: { balance: { decrement: D(80000) } },
      });
      expect(prisma.rentalCleaning.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            storeId: STORE,
            startDate: rentalBoundary(START),
            endDate: rentalBoundary(addLocalDays(START, 3)),
            days: 3,
            expenseTransactionId: 'tx',
            createdBy: 'staff',
          }),
        }),
      );
      expect(row).toEqual(
        expect.objectContaining({
          firstDay: START,
          lastDay: addLocalDays(START, 2),
          state: 'PLANNED',
          canCancel: true,
        }),
      );
    });

    it('allows bookings back to back on both sides (R1 noon boundary)', async () => {
      prisma.orderItem.findMany.mockResolvedValue([
        booking(RENTAL, addLocalDays(START, -2), START),
        booking(OTHER_RENTAL, addLocalDays(START, 1), addLocalDays(START, 3)),
      ]);

      await expect(service.create(dto(), manager)).resolves.toBeDefined();
    });

    it('rejects a day when the only unit is booked, naming the booking', async () => {
      prisma.orderItem.findMany.mockResolvedValue([
        booking(RENTAL, addLocalDays(START, 1), addLocalDays(START, 3)),
      ]);
      prisma.rental.findMany.mockResolvedValue([
        {
          id: RENTAL,
          orderId: 'order',
          startDate: rentalBoundary(addLocalDays(START, 1)),
          endDate: rentalBoundary(addLocalDays(START, 3)),
          order: { customer: { user: { fullName: 'Азиз К.' } } },
        },
      ]);

      const error = await service
        .create(dto({ days: 2 }), manager)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      const body = (error as ConflictException).getResponse() as {
        code: string;
        conflicts: { date: string; rentals: { code: string }[] }[];
      };
      expect(body.code).toBe('NOT_AVAILABLE');
      expect(body.conflicts).toEqual([
        expect.objectContaining({
          date: addLocalDays(START, 1),
          rentals: [
            expect.objectContaining({
              rentalId: RENTAL,
              code: '888888',
              customerName: 'Азиз К.',
            }),
          ],
        }),
      ]);
      expect(prisma.cashTransaction.create).not.toHaveBeenCalled();
      expect(prisma.rentalCleaning.create).not.toHaveBeenCalled();
    });

    it('counts other planned cleanings as busy units', async () => {
      prisma.inventory.findFirst.mockResolvedValue({ quantity: 2 });
      prisma.orderItem.findMany.mockResolvedValue([
        booking(RENTAL, START, addLocalDays(START, 2)),
      ]);
      prisma.rentalCleaning.findMany.mockResolvedValue([
        {
          id: CLEANING,
          variantId: DRESS,
          startDate: rentalBoundary(START),
          endDate: rentalBoundary(addLocalDays(START, 1)),
        },
      ]);

      await expect(service.create(dto(), manager)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('fits when a second unit is free', async () => {
      prisma.inventory.findFirst.mockResolvedValue({ quantity: 2 });
      prisma.orderItem.findMany.mockResolvedValue([
        booking(RENTAL, START, addLocalDays(START, 2)),
      ]);

      await expect(service.create(dto(), manager)).resolves.toBeDefined();
    });

    it('is for owners and managers only', async () => {
      await expect(service.create(dto(), seller)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.rentalCleaning.create).not.toHaveBeenCalled();
    });

    it('rejects a start in the past', async () => {
      await expect(
        service.create(
          dto({ startDate: addLocalDays(todayLocalDate(), -1) }),
          manager,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a variant that is not rented out', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({ canRent: false });

      await expect(service.create(dto(), manager)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('needs an open cashbox', async () => {
      prisma.cashbox.findMany.mockResolvedValue([]);

      await expect(service.create(dto(), manager)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.rentalCleaning.create).not.toHaveBeenCalled();
    });
  });

  describe('check', () => {
    it('reports free units without writing anything', async () => {
      prisma.inventory.findFirst.mockResolvedValue({ quantity: 3 });
      prisma.orderItem.findMany.mockResolvedValue([
        booking(RENTAL, START, addLocalDays(START, 2)),
      ]);

      const result = await service.check(
        {
          warehouseId: WAREHOUSE,
          variantId: DRESS,
          startDate: START,
          days: '2',
        },
        seller,
      );

      expect(result).toEqual(
        expect.objectContaining({ ok: true, owned: 3, available: 2 }),
      );
      expect(prisma.cashTransaction.create).not.toHaveBeenCalled();
    });

    it('rejects days out of range', async () => {
      await expect(
        service.check(
          {
            warehouseId: WAREHOUSE,
            variantId: DRESS,
            startDate: START,
            days: '0',
          },
          manager,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('cancel', () => {
    function stored(cashboxStatus: CashStatus) {
      return {
        id: CLEANING,
        storeId: STORE,
        warehouseId: WAREHOUSE,
        amount: D(80000),
        paymentType: PaymentType.CARD,
        comment: 'Oq Tong',
        expenseTransaction: {
          cashbox: {
            id: 'expense-cashbox',
            storeId: STORE,
            status: cashboxStatus,
          },
        },
      };
    }

    beforeEach(() => {
      prisma.rentalCleaning.findUniqueOrThrow.mockResolvedValue({
        status: RentalCleaningStatus.ACTIVE,
        startDate: rentalBoundary(START),
      });
      prisma.rentalCleaning.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(cleaningRow(data)),
      );
      prisma.cashbox.findFirst.mockResolvedValue({
        id: 'expense-cashbox',
        storeId: STORE,
        status: CashStatus.OPEN,
      });
    });

    it('writes the expense back to the open expense cashbox', async () => {
      prisma.rentalCleaning.findUnique.mockResolvedValue(
        stored(CashStatus.OPEN),
      );

      const row = await service.cancel(CLEANING, {}, manager);

      expect(prisma.cashTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          cashboxId: 'expense-cashbox',
          type: CashTransactionType.INCOME,
          category: CashTransactionCategory.DRY_CLEANING,
          paymentType: PaymentType.CARD,
          amount: D(80000),
        }),
        select: { id: true },
      });
      expect(prisma.cashbox.update).toHaveBeenCalledWith({
        where: { id: 'expense-cashbox' },
        data: { balance: { increment: D(80000) } },
      });
      expect(prisma.rentalCleaning.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: RentalCleaningStatus.CANCELLED,
            refundTransactionId: 'tx',
            cancelledBy: 'staff',
          }),
        }),
      );
      expect(row.state).toBe('CANCELLED');
    });

    it("uses the employee's own cashbox when the expense cashbox is closed", async () => {
      prisma.rentalCleaning.findUnique.mockResolvedValue(
        stored(CashStatus.CLOSED),
      );

      await service.cancel(CLEANING, {}, manager);

      expect(prisma.cashTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ cashboxId: 'own-cashbox' }),
        }),
      );
    });

    it('refuses once the cleaning has started', async () => {
      prisma.rentalCleaning.findUnique.mockResolvedValue(
        stored(CashStatus.OPEN),
      );
      prisma.rentalCleaning.findUniqueOrThrow.mockResolvedValue({
        status: RentalCleaningStatus.ACTIVE,
        startDate: new Date(Date.now() - 1000),
      });

      await expect(
        service.cancel(CLEANING, {}, manager),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.cashTransaction.create).not.toHaveBeenCalled();
    });

    it('refuses a cleaning cancelled already', async () => {
      prisma.rentalCleaning.findUnique.mockResolvedValue(
        stored(CashStatus.OPEN),
      );
      prisma.rentalCleaning.findUniqueOrThrow.mockResolvedValue({
        status: RentalCleaningStatus.CANCELLED,
        startDate: rentalBoundary(START),
      });

      await expect(
        service.cancel(CLEANING, {}, manager),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('is for owners and managers only', async () => {
      await expect(service.cancel(CLEANING, {}, seller)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('hides cleanings of another store', async () => {
      prisma.rentalCleaning.findUnique.mockResolvedValue({
        ...stored(CashStatus.OPEN),
        storeId: 'other-store',
      });

      await expect(service.cancel(CLEANING, {}, manager)).rejects.toThrow(
        'Dry cleaning not found',
      );
    });
  });
});
