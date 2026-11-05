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
  OrderStatus,
  PaymentType,
  RentalStatus,
  StaffRole,
  UserRole,
  UserType,
} from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { CreateRentalDto } from './dto/create-rental.dto';
import { RentalAvailabilityService } from './rental-availability.service';
import { addLocalDays, rentalBoundary, todayLocalDate } from './rental-days';
import { RentalService } from './rental.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const FOREIGN_STORE = '22222222-2222-4222-8222-222222222222';
const WAREHOUSE = '33333333-3333-4333-8333-333333333333';
const ORDER = '44444444-4444-4444-8444-444444444444';
const DRESS = '55555555-5555-4555-8555-555555555555';
const SUIT = '66666666-6666-4666-8666-666666666666';
const CUSTOMER = '77777777-7777-4777-8777-777777777777';
const RENTAL = '88888888-8888-4888-8888-888888888888';

const D = (v: number | string) => new Prisma.Decimal(v);
const START = addLocalDays(todayLocalDate(), 10);
const END = addLocalDays(START, 2);

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

function bookingDto(extra: Partial<CreateRentalDto> = {}): CreateRentalDto {
  return {
    warehouseId: WAREHOUSE,
    customerId: CUSTOMER,
    startDate: START,
    endDate: END,
    items: [
      { variantId: DRESS, quantity: 1 },
      { variantId: SUIT, quantity: 1 },
    ],
    services: [{ name: 'Makeup', price: 900000 }],
    ...extra,
  };
}

function rentalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RENTAL,
    orderId: ORDER,
    storeId: STORE,
    warehouseId: WAREHOUSE,
    customerId: CUSTOMER,
    status: RentalStatus.BOOKED,
    startDate: rentalBoundary(START),
    endDate: rentalBoundary(END),
    plannedDays: 2,
    order: {
      id: ORDER,
      totalAmount: D(1600000),
      paidAmount: D(0),
      items: [],
      services: [],
      payments: [],
    },
    collaterals: [],
    returns: [],
    ...overrides,
  };
}

describe('RentalService', () => {
  let service: RentalService;
  const prisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    store: { findUnique: jest.fn() },
    warehouse: { findFirst: jest.fn() },
    customer: { findUnique: jest.fn() },
    productVariant: { findMany: jest.fn() },
    order: {
      create: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    orderItem: { deleteMany: jest.fn(), createMany: jest.fn() },
    additionalService: { deleteMany: jest.fn(), createMany: jest.fn() },
    rental: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    rentalCollateral: { createMany: jest.fn() },
    payment: { createMany: jest.fn() },
    cashTransaction: { createMany: jest.fn() },
    cashbox: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  };
  const availability = {
    lockInventory: jest.fn(),
    getAvailability: jest.fn(),
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
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER });
    prisma.productVariant.findMany.mockResolvedValue([
      {
        id: DRESS,
        storeId: STORE,
        canRent: true,
        rentPricePerDay: D(200000),
        product: { isArchived: false },
      },
      {
        id: SUIT,
        storeId: STORE,
        canRent: true,
        rentPricePerDay: D(150000),
        product: { isArchived: false },
      },
    ]);
    availability.getAvailability.mockResolvedValue([
      { variantId: DRESS, owned: 3, available: 2 },
      { variantId: SUIT, owned: 1, available: 1 },
    ]);
    prisma.order.create.mockResolvedValue({ id: ORDER });
    prisma.rental.create.mockResolvedValue({ id: RENTAL, orderId: ORDER });
    prisma.rental.findUnique.mockResolvedValue(rentalRow());
    prisma.cashbox.findMany.mockResolvedValue([
      { id: 'cashbox', warehouseId: WAREHOUSE, status: CashStatus.OPEN },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RentalService,
        { provide: PrismaService, useValue: prisma },
        { provide: RentalAvailabilityService, useValue: availability },
        { provide: getLoggerToken(RentalService.name), useValue: logger },
      ],
    }).compile();

    service = module.get<RentalService>(RentalService);
  });

  describe('create', () => {
    it('books: prices days on the backend, order in HOLD, no stock change', async () => {
      await service.create(bookingDto(), makeUser(StaffRole.SELLER));

      const order = prisma.order.create.mock.calls[0][0].data;
      expect(order).toMatchObject({
        storeId: STORE,
        warehouseId: WAREHOUSE,
        customerId: CUSTOMER,
        cashierId: 'staff',
        status: OrderStatus.HOLD,
      });
      // 200 000 × 2 + 150 000 × 2 + 900 000
      expect(Number(order.totalAmount)).toBe(1600000);
      const dress = order.items.create[0];
      expect(Number(dress.retailPrice)).toBe(400000);
      expect(dress.costAtSale).toBe(0);

      const rental = prisma.rental.create.mock.calls[0][0].data;
      expect(rental).toMatchObject({ orderId: ORDER, plannedDays: 2 });
      expect(rental.startDate).toEqual(rentalBoundary(START));
      expect(availability.lockInventory).toHaveBeenCalledWith(
        prisma,
        WAREHOUSE,
        [DRESS, SUIT],
      );
    });

    it('lets a manager spread a discount over items and services', async () => {
      await service.create(
        bookingDto({
          items: [
            { variantId: DRESS, quantity: 1, sale: 25000 },
            { variantId: SUIT, quantity: 1, sale: 18750 },
          ],
          services: [{ name: 'Makeup', price: 900000, sale: 56250 }],
        }),
        makeUser(StaffRole.MANAGER),
      );
      const order = prisma.order.create.mock.calls[0][0].data;
      expect(Number(order.totalAmount)).toBe(1500000);
      expect(Number(order.services.create[0].sale)).toBe(56250);
    });

    it('forbids a seller to lower an item price', async () => {
      await expect(
        service.create(
          bookingDto({ items: [{ variantId: DRESS, quantity: 1, sale: 1 }] }),
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('rejects a store without rental', async () => {
      prisma.store.findUnique.mockResolvedValue({ rentalEnabled: false });
      await expect(
        service.create(bookingDto(), makeUser(StaffRole.OWNER)),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'RENTAL_DISABLED' }),
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a warehouse of another store', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(null);
      await expect(
        service.create(bookingDto(), makeUser(StaffRole.OWNER)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a variant that cannot be rented', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        {
          id: DRESS,
          storeId: STORE,
          canRent: false,
          rentPricePerDay: null,
          product: { isArchived: false },
        },
      ]);
      await expect(
        service.create(
          bookingDto({ items: [{ variantId: DRESS, quantity: 1 }] }),
          makeUser(StaffRole.OWNER),
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'VARIANT_NOT_RENTABLE',
          variantId: DRESS,
        }),
      });
    });

    it('rejects a variant of another store', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        {
          id: DRESS,
          storeId: FOREIGN_STORE,
          canRent: true,
          rentPricePerDay: D(200000),
          product: { isArchived: false },
        },
      ]);
      await expect(
        service.create(
          bookingDto({ items: [{ variantId: DRESS, quantity: 1 }] }),
          makeUser(StaffRole.OWNER),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('answers 409 NOT_AVAILABLE with the variant when units are taken', async () => {
      availability.getAvailability.mockResolvedValue([
        { variantId: DRESS, owned: 3, available: 2 },
        { variantId: SUIT, owned: 1, available: 0 },
      ]);
      const error = await service
        .create(bookingDto(), makeUser(StaffRole.OWNER))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'NOT_AVAILABLE',
        variantId: SUIT,
        available: 0,
      });
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('rejects dates in the past and an end not after the start', async () => {
      const yesterday = addLocalDays(todayLocalDate(), -1);
      await expect(
        service.create(
          bookingDto({ startDate: yesterday, endDate: END }),
          makeUser(StaffRole.OWNER),
        ),
      ).rejects.toThrow('past');
      await expect(
        service.create(
          bookingDto({ startDate: END, endDate: START }),
          makeUser(StaffRole.OWNER),
        ),
      ).rejects.toThrow('before endDate');
    });

    it('rejects the same variant twice', async () => {
      await expect(
        service.create(
          bookingDto({
            items: [
              { variantId: DRESS, quantity: 1 },
              { variantId: DRESS, quantity: 1 },
            ],
          }),
          makeUser(StaffRole.OWNER),
        ),
      ).rejects.toThrow('only once');
    });
  });

  describe('update', () => {
    const booked = (overrides: Record<string, unknown> = {}) =>
      rentalRow({
        order: {
          ...rentalRow().order,
          items: [
            { variantId: DRESS, sale: D(25000) },
            { variantId: SUIT, sale: D(0) },
          ],
        },
        ...overrides,
      });

    beforeEach(() => {
      prisma.rental.findUnique.mockResolvedValue(booked());
      prisma.order.findUniqueOrThrow.mockResolvedValue({ paidAmount: D(0) });
    });

    it('moves the dates and checks availability without the booking itself', async () => {
      const newStart = addLocalDays(START, 2);
      await service.update(
        RENTAL,
        bookingDto({ startDate: newStart, endDate: addLocalDays(newStart, 3) }),
        makeUser(StaffRole.OWNER),
      );
      expect(availability.getAvailability.mock.calls[0][1]).toMatchObject({
        excludeRentalId: RENTAL,
      });
      expect(prisma.rental.update.mock.calls[0][0].data).toMatchObject({
        plannedDays: 3,
        startDate: rentalBoundary(newStart),
      });
      // 200 000 × 3 + 150 000 × 3 + 900 000
      expect(
        Number(prisma.order.update.mock.calls[0][0].data.totalAmount),
      ).toBe(1950000);
      expect(prisma.orderItem.deleteMany).toHaveBeenCalledWith({
        where: { orderId: ORDER },
      });
    });

    it('lets a seller keep a discount already saved on the booking', async () => {
      await expect(
        service.update(
          RENTAL,
          bookingDto({
            items: [
              { variantId: DRESS, quantity: 1, sale: 25000 },
              { variantId: SUIT, quantity: 1 },
            ],
          }),
          makeUser(StaffRole.SELLER),
        ),
      ).resolves.toBeDefined();
      await expect(
        service.update(
          RENTAL,
          bookingDto({
            items: [{ variantId: DRESS, quantity: 1, sale: 30000 }],
          }),
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a total below the amount already paid', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        paidAmount: D(1000000),
      });
      await expect(
        service.update(
          RENTAL,
          bookingDto({ services: [] }),
          makeUser(StaffRole.OWNER),
        ),
      ).rejects.toThrow('already paid');
      expect(prisma.orderItem.deleteMany).not.toHaveBeenCalled();
    });

    it('changes only a booked rental', async () => {
      prisma.rental.findUnique.mockResolvedValue(
        booked({ status: RentalStatus.ISSUED }),
      );
      await expect(
        service.update(RENTAL, bookingDto(), makeUser(StaffRole.OWNER)),
      ).rejects.toThrow('Only a booked rental');
    });

    it('hides a rental of another store', async () => {
      prisma.rental.findUnique.mockResolvedValue(
        booked({ storeId: FOREIGN_STORE }),
      );
      await expect(
        service.update(RENTAL, bookingDto(), makeUser(StaffRole.OWNER)),
      ).rejects.toThrow('Rental not found');
    });
  });

  describe('addPayments', () => {
    const payable = (status: RentalStatus, total = 1600000, paid = 0) => ({
      status,
      order: { totalAmount: D(total), paidAmount: D(paid) },
    });

    beforeEach(() => {
      prisma.rental.findUniqueOrThrow.mockResolvedValue(
        payable(RentalStatus.BOOKED),
      );
    });

    it('takes a prepayment into the cashbox as RENTAL income', async () => {
      await service.addPayments(
        RENTAL,
        {
          payments: [{ type: PaymentType.CASH, amount: 500000 }],
          collaterals: [{ type: 'PASSPORT', description: 'AA1234567' }],
        },
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.cashTransaction.createMany.mock.calls[0][0].data).toEqual([
        expect.objectContaining({
          cashboxId: 'cashbox',
          type: CashTransactionType.INCOME,
          category: CashTransactionCategory.RENTAL,
          amount: 500000,
          orderId: ORDER,
        }),
      ]);
      expect(
        Number(prisma.cashbox.update.mock.calls[0][0].data.balance.increment),
      ).toBe(500000);
      const order = prisma.order.update.mock.calls[0][0].data;
      expect(Number(order.paidAmount)).toBe(500000);
      // Still HOLD while booked
      expect(order).not.toHaveProperty('status');
      expect(prisma.rentalCollateral.createMany).toHaveBeenCalledWith({
        data: [
          {
            rentalId: RENTAL,
            type: 'PASSPORT',
            description: 'AA1234567',
            receivedBy: 'staff',
          },
        ],
      });
    });

    it('takes a collateral without a cashbox', async () => {
      await service.addPayments(
        RENTAL,
        { collaterals: [{ type: 'GOLD', description: 'Chain 15g' }] },
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.cashbox.findMany).not.toHaveBeenCalled();
      expect(prisma.payment.createMany).not.toHaveBeenCalled();
      expect(prisma.rentalCollateral.createMany).toHaveBeenCalled();
    });

    it('rejects an overpayment', async () => {
      prisma.rental.findUniqueOrThrow.mockResolvedValue(
        payable(RentalStatus.BOOKED, 1600000, 1500000),
      );
      await expect(
        service.addPayments(
          RENTAL,
          { payments: [{ type: PaymentType.CARD, amount: 200000 }] },
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toThrow('exceeds order total');
      expect(prisma.payment.createMany).not.toHaveBeenCalled();
    });

    it('rejects a payment for a cancelled or returned rental', async () => {
      prisma.rental.findUniqueOrThrow.mockResolvedValue(
        payable(RentalStatus.RETURNED),
      );
      await expect(
        service.addPayments(
          RENTAL,
          { payments: [{ type: PaymentType.CASH, amount: 1000 }] },
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toThrow('RETURNED');
    });

    it('settles a partially returned rental: DEBT until fully paid', async () => {
      prisma.rental.findUniqueOrThrow.mockResolvedValue(
        payable(RentalStatus.PARTIALLY_RETURNED, 1600000, 500000),
      );
      await service.addPayments(
        RENTAL,
        { payments: [{ type: PaymentType.CASH, amount: 100000 }] },
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.order.update.mock.calls[0][0].data.status).toBe(
        OrderStatus.DEBT,
      );
      await service.addPayments(
        RENTAL,
        { payments: [{ type: PaymentType.CASH, amount: 1100000 }] },
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.order.update.mock.calls[1][0].data.status).toBe(
        OrderStatus.COMPLETED,
      );
    });

    it('requires an open cashbox for money', async () => {
      prisma.cashbox.findMany.mockResolvedValue([]);
      await expect(
        service.addPayments(
          RENTAL,
          { payments: [{ type: PaymentType.CASH, amount: 1000 }] },
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toThrow('No open cashbox');
    });

    it('rejects an empty request', async () => {
      await expect(
        service.addPayments(
          RENTAL,
          { payments: [{ type: PaymentType.CASH, amount: 0 }] },
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toThrow('Nothing to save');
    });
  });

  describe('findAll', () => {
    beforeEach(() => {
      prisma.rental.count.mockResolvedValue(0);
      prisma.rental.findMany.mockResolvedValue([]);
    });

    it('limits a seller to their warehouses and filters overdue rentals', async () => {
      await service.findAll({ overdue: 'true' }, makeUser(StaffRole.SELLER));
      const where = prisma.rental.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        storeId: STORE,
        warehouseId: { in: [WAREHOUSE] },
      });
      expect(where.AND[0].status.in).toEqual([
        RentalStatus.ISSUED,
        RentalStatus.PARTIALLY_RETURNED,
      ]);
    });

    it('lets the owner see the whole store', async () => {
      await service.findAll({}, makeUser(StaffRole.OWNER));
      expect(prisma.rental.findMany.mock.calls[0][0].where).not.toHaveProperty(
        'warehouseId',
      );
    });

    it('rejects an unknown status', async () => {
      await expect(
        service.findAll({ status: 'LOST' }, makeUser(StaffRole.OWNER)),
      ).rejects.toThrow('Unknown rental status');
    });
  });
});
