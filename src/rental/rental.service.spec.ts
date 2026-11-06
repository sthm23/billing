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
    productVariant: { findMany: jest.fn(), findFirst: jest.fn() },
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
    rentalCollateral: {
      createMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    rentalReturn: { create: jest.fn() },
    inventory: { findFirst: jest.fn() },
    payment: { createMany: jest.fn() },
    cashTransaction: { createMany: jest.fn(), create: jest.fn() },
    cashbox: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  };
  const availability = {
    lockInventory: jest.fn(),
    getAvailability: jest.fn(),
    findOccupancy: jest.fn(),
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

    const whereOf = () => prisma.rental.findMany.mock.calls[0][0].where;

    it('limits a seller to their warehouses and filters overdue rentals', async () => {
      await service.findAll({ overdue: 'true' }, makeUser(StaffRole.SELLER));
      const where = whereOf();
      expect(where.AND[0]).toEqual({
        storeId: STORE,
        warehouseId: { in: [WAREHOUSE] },
      });
      expect(where.AND[1].status.in).toEqual([
        RentalStatus.ISSUED,
        RentalStatus.PARTIALLY_RETURNED,
      ]);
    });

    it('lets the owner see the whole store', async () => {
      await service.findAll({}, makeUser(StaffRole.OWNER));
      expect(whereOf().AND).toEqual([{ storeId: STORE }]);
    });

    it('rejects an unknown status', async () => {
      await expect(
        service.findAll({ status: 'LOST' }, makeUser(StaffRole.OWNER)),
      ).rejects.toThrow('Unknown rental status');
    });

    it('returnToday: with the customer, due back at noon today', async () => {
      await service.findAll({ view: 'returnToday' }, makeUser(StaffRole.OWNER));
      const today = todayLocalDate();
      expect(whereOf().AND[1]).toEqual({
        status: { in: [RentalStatus.ISSUED, RentalStatus.PARTIALLY_RETURNED] },
        endDate: {
          gte: rentalBoundary(today),
          lt: rentalBoundary(addLocalDays(today, 1)),
        },
      });
    });

    it('issueToday: booked, started by today, not over', async () => {
      await service.findAll({ view: 'issueToday' }, makeUser(StaffRole.OWNER));
      const view = whereOf().AND[1];
      expect(view.status).toBe(RentalStatus.BOOKED);
      expect(view.startDate.lt).toEqual(
        rentalBoundary(addLocalDays(todayLocalDate(), 1)),
      );
      expect(view.endDate.gt).toBeInstanceOf(Date);
    });

    it('searches by name, code prefix and phone digits', async () => {
      await service.findAll({ q: 'a1b2' }, makeUser(StaffRole.OWNER));
      expect(whereOf().AND[1].OR).toEqual(
        expect.arrayContaining([{ id: { startsWith: 'a1b2' } }]),
      );

      prisma.rental.findMany.mockClear();
      await service.findAll({ q: '+998 90 12' }, makeUser(StaffRole.OWNER));
      const or = whereOf().AND[1].OR;
      expect(or).toEqual(
        expect.arrayContaining([
          { order: { customer: { user: { phone: { contains: '9989012' } } } } },
        ]),
      );
      expect(or).not.toEqual(
        expect.arrayContaining([{ id: expect.anything() }]),
      );
    });

    it('filters by variant and sorts by start date', async () => {
      await service.findAll(
        { variantId: DRESS, sort: 'asc' },
        makeUser(StaffRole.OWNER),
      );
      const args = prisma.rental.findMany.mock.calls[0][0];
      expect(args.where.AND[1]).toEqual({
        order: { items: { some: { variantId: DRESS } } },
      });
      expect(args.orderBy[0]).toEqual({ startDate: 'asc' });
    });

    it('returns the short code and item thumbnails', async () => {
      prisma.rental.count.mockResolvedValue(1);
      prisma.rental.findMany.mockResolvedValue([
        {
          id: RENTAL,
          status: RentalStatus.BOOKED,
          endDate: rentalBoundary(addLocalDays(todayLocalDate(), 2)),
          order: {
            id: ORDER,
            status: 'HOLD',
            totalAmount: D(1600000),
            paidAmount: D(500000),
            customer: null,
            items: [
              {
                quantity: 2,
                variant: {
                  id: DRESS,
                  product: { name: 'Aurora', images: [{ url: 'a.jpg' }] },
                },
              },
            ],
          },
        },
      ]);
      const res = await service.findAll({}, makeUser(StaffRole.OWNER));
      expect(res.data[0]).toMatchObject({
        code: RENTAL.slice(0, 6).toUpperCase(),
        itemCount: 2,
        items: [
          {
            variantId: DRESS,
            productName: 'Aurora',
            imageUrl: 'a.jpg',
            quantity: 2,
          },
        ],
      });
      expect(res.data[0].order.dueAmount.toNumber()).toBe(1100000);
    });
  });

  describe('getSummary', () => {
    it('counts every quick view in the user scope', async () => {
      prisma.rental.count.mockResolvedValue(3);
      const res = await service.getSummary(makeUser(StaffRole.SELLER));
      expect(res).toEqual({
        issueToday: 3,
        returnToday: 3,
        overdue: 3,
        booked: 3,
        out: 3,
        all: 3,
      });
      expect(prisma.rental.count).toHaveBeenCalledTimes(6);
      expect(prisma.rental.count.mock.calls[0][0].where.AND[0]).toEqual({
        storeId: STORE,
        warehouseId: { in: [WAREHOUSE] },
      });
    });
  });

  describe('findSimilar', () => {
    const variantRow = (id: string, productId: string) => ({
      id,
      sku: id,
      rentPricePerDay: D(200000),
      product: { id: productId, name: productId, images: [] },
      attributes: [
        {
          value: {
            valueString: '46',
            valueNumber: null,
            valueBool: null,
            attribute: { name: 'Size' },
          },
        },
      ],
    });
    const query = {
      warehouseId: WAREHOUSE,
      variantId: DRESS,
      startDate: addLocalDays(todayLocalDate(), 1),
      endDate: addLocalDays(todayLocalDate(), 3),
    };

    it('lists other sizes, then the category, free ones first', async () => {
      prisma.productVariant.findFirst.mockResolvedValue({
        productId: 'aurora',
        product: { categoryId: 'dresses' },
      });
      prisma.productVariant.findMany
        .mockResolvedValueOnce([
          variantRow('au44', 'aurora'),
          variantRow('au48', 'aurora'),
        ])
        .mockResolvedValueOnce([variantRow('bella', 'bella')]);
      availability.getAvailability.mockResolvedValue([
        { variantId: 'au44', owned: 1, available: 0 },
        { variantId: 'au48', owned: 2, available: 2 },
        { variantId: 'bella', owned: 1, available: 1 },
      ]);
      const res = await service.findSimilar(query, makeUser(StaffRole.SELLER));
      expect(res.sameProduct.map((r) => r.variantId)).toEqual(['au48', 'au44']);
      expect(res.sameProduct[0]).toMatchObject({
        available: 2,
        owned: 2,
        attributes: [{ name: 'Size', value: '46' }],
      });
      expect(res.sameCategory.map((r) => r.variantId)).toEqual(['bella']);
      const categoryWhere =
        prisma.productVariant.findMany.mock.calls[1][0].where;
      expect(categoryWhere).toMatchObject({
        canRent: true,
        id: { not: DRESS },
        productId: { not: 'aurora' },
        product: { categoryId: 'dresses', isArchived: false },
      });
    });

    it('skips the category without one and 404s a foreign variant', async () => {
      prisma.productVariant.findFirst.mockResolvedValueOnce({
        productId: 'aurora',
        product: { categoryId: null },
      });
      prisma.productVariant.findMany.mockResolvedValueOnce([]);
      const res = await service.findSimilar(query, makeUser(StaffRole.OWNER));
      expect(res).toEqual({ sameProduct: [], sameCategory: [] });
      expect(prisma.productVariant.findMany).toHaveBeenCalledTimes(1);

      prisma.productVariant.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.findSimilar(query, makeUser(StaffRole.OWNER)),
      ).rejects.toThrow('Product variant not found');
    });
  });

  describe('issue', () => {
    const today = todayLocalDate();
    const issuable = (overrides: Record<string, unknown> = {}) => ({
      status: RentalStatus.BOOKED,
      startDate: rentalBoundary(today),
      endDate: rentalBoundary(addLocalDays(today, 2)),
      _count: { collaterals: 0 },
      order: {
        totalAmount: D(1600000),
        paidAmount: D(500000),
        items: [{ variantId: DRESS, quantity: 1 }],
      },
      ...overrides,
    });

    beforeEach(() => {
      prisma.rental.findUniqueOrThrow.mockResolvedValue(issuable());
      availability.getAvailability.mockResolvedValue([
        { variantId: DRESS, owned: 1, available: 1 },
      ]);
    });

    it('hands over: ISSUED, soldAt set, order stays HOLD, extra payment and passport taken', async () => {
      await service.issue(
        RENTAL,
        {
          payments: [{ type: PaymentType.CARD, amount: 200000 }],
          collaterals: [{ type: 'PASSPORT', description: 'AA1234567' }],
        },
        makeUser(StaffRole.SELLER),
      );
      const order = prisma.order.update.mock.calls[0][0].data;
      expect(Number(order.paidAmount)).toBe(700000);
      expect(order.soldAt).toBeInstanceOf(Date);
      expect(order).not.toHaveProperty('status');
      expect(prisma.rental.update.mock.calls[0][0].data).toMatchObject({
        status: RentalStatus.ISSUED,
        issuedBy: 'staff',
        issuedWithoutCollateral: false,
      });
      expect(
        prisma.cashTransaction.createMany.mock.calls[0][0].data[0],
      ).toMatchObject({
        category: CashTransactionCategory.RENTAL,
        amount: 200000,
      });
      expect(prisma.rentalCollateral.createMany).toHaveBeenCalled();
      // Free units are checked from now on without the rental itself
      expect(availability.getAvailability.mock.calls[0][1]).toMatchObject({
        excludeRentalId: RENTAL,
        variantIds: [DRESS],
      });
    });

    it('marks an issue without any collateral held', async () => {
      await service.issue(RENTAL, {}, makeUser(StaffRole.SELLER));
      expect(
        prisma.rental.update.mock.calls[0][0].data.issuedWithoutCollateral,
      ).toBe(true);
    });

    it('a collateral taken at booking counts', async () => {
      prisma.rental.findUniqueOrThrow.mockResolvedValue(
        issuable({ _count: { collaterals: 1 } }),
      );
      await service.issue(RENTAL, {}, makeUser(StaffRole.SELLER));
      expect(
        prisma.rental.update.mock.calls[0][0].data.issuedWithoutCollateral,
      ).toBe(false);
    });

    it('refuses to issue before the start date', async () => {
      prisma.rental.findUniqueOrThrow.mockResolvedValue(
        issuable({
          startDate: rentalBoundary(addLocalDays(today, 1)),
          endDate: rentalBoundary(addLocalDays(today, 3)),
        }),
      );
      await expect(
        service.issue(RENTAL, {}, makeUser(StaffRole.OWNER)),
      ).rejects.toThrow('before its start date');
      expect(prisma.rental.update).not.toHaveBeenCalled();
    });

    it('answers 409 when the unit is not back in the salon', async () => {
      availability.getAvailability.mockResolvedValue([
        { variantId: DRESS, owned: 1, available: 0 },
      ]);
      const error = await service
        .issue(RENTAL, {}, makeUser(StaffRole.OWNER))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'NOT_AVAILABLE',
        variantId: DRESS,
      });
      expect(prisma.rental.update).not.toHaveBeenCalled();
    });

    it('issues only a booked rental', async () => {
      prisma.rental.findUniqueOrThrow.mockResolvedValue(
        issuable({ status: RentalStatus.ISSUED }),
      );
      await expect(
        service.issue(RENTAL, {}, makeUser(StaffRole.OWNER)),
      ).rejects.toThrow('Only a booked rental');
    });
  });

  describe('returns', () => {
    const issuedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const returnable = (overrides: Record<string, unknown> = {}) => ({
      id: RENTAL,
      storeId: STORE,
      warehouseId: WAREHOUSE,
      orderId: ORDER,
      status: RentalStatus.ISSUED,
      // Started two days ago, ends in two days
      startDate: issuedAt,
      endDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      plannedDays: 4,
      issuedAt,
      order: {
        totalAmount: D(2000000),
        paidAmount: D(2000000),
        items: [
          {
            id: 'dress-item',
            variantId: DRESS,
            quantity: 1,
            retailPrice: D(800000),
            sale: D(0),
            rentalReturnItems: [],
          },
          {
            id: 'suit-item',
            variantId: SUIT,
            quantity: 1,
            retailPrice: D(600000),
            sale: D(0),
            rentalReturnItems: [],
          },
        ],
      },
      ...overrides,
    });
    const both = [
      { orderItemId: 'dress-item', quantity: 1, cleaningDays: 1 },
      { orderItemId: 'suit-item', quantity: 1, cleaningDays: 0 },
    ];

    beforeEach(() => {
      prisma.rental.findUnique.mockImplementation(
        (args: { select?: unknown; include?: unknown }) =>
          Promise.resolve(args.include ? rentalRow() : returnable()),
      );
      prisma.rental.findUniqueOrThrow.mockResolvedValue(returnable());
      prisma.rentalReturn.create.mockResolvedValue({ id: 'return' });
    });

    it('early return: manager lowers the total, the overpaid part goes back from the cashbox', async () => {
      await service.createReturn(
        RENTAL,
        {
          items: both,
          earlyReturnRefund: 300000,
          refundPaymentType: PaymentType.CASH,
        },
        makeUser(StaffRole.MANAGER),
      );
      const created = prisma.rentalReturn.create.mock.calls[0][0].data;
      expect(Number(created.earlyReturnRefund)).toBe(300000);
      expect(created.items.create[0]).toMatchObject({
        orderItemId: 'dress-item',
        cleaningDays: 1,
      });
      expect(prisma.cashTransaction.create.mock.calls[0][0].data).toMatchObject(
        {
          type: CashTransactionType.EXPENSE,
          category: CashTransactionCategory.RETURN,
          paymentType: PaymentType.CASH,
          orderId: ORDER,
        },
      );
      expect(
        Number(prisma.cashbox.update.mock.calls[0][0].data.balance.decrement),
      ).toBe(300000);
      const order = prisma.order.update.mock.calls[0][0].data;
      expect(Number(order.totalAmount)).toBe(1700000);
      expect(Number(order.paidAmount)).toBe(1700000);
      expect(order.status).toBe(OrderStatus.COMPLETED);
      expect(prisma.rental.update.mock.calls[0][0].data).toMatchObject({
        status: RentalStatus.RETURNED,
      });
    });

    it('forbids a seller to lower the total on an early return', async () => {
      await expect(
        service.createReturn(
          RENTAL,
          { items: both, earlyReturnRefund: 1 },
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.rentalReturn.create).not.toHaveBeenCalled();
    });

    it('forbids a seller to backdate a return', async () => {
      await expect(
        service.createReturn(
          RENTAL,
          {
            items: both,
            returnedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          },
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires the payout type when money goes back', async () => {
      await expect(
        service.createReturn(
          RENTAL,
          { items: both, earlyReturnRefund: 300000 },
          makeUser(StaffRole.OWNER),
        ),
      ).rejects.toThrow('refundPaymentType is required');
      expect(prisma.rentalReturn.create).not.toHaveBeenCalled();
    });

    it('partial return without full payment: order DEBT, no cashbox needed', async () => {
      prisma.rental.findUniqueOrThrow.mockResolvedValue(
        returnable({
          order: { ...returnable().order, paidAmount: D(500000) },
        }),
      );
      await service.createReturn(
        RENTAL,
        { items: [both[0]] },
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.cashbox.findMany).not.toHaveBeenCalled();
      expect(prisma.order.update.mock.calls[0][0].data.status).toBe(
        OrderStatus.DEBT,
      );
      expect(prisma.rental.update.mock.calls[0][0].data).toEqual({
        status: RentalStatus.PARTIALLY_RETURNED,
      });
    });

    it('preview computes without writing', async () => {
      const res = await service.previewReturn(
        RENTAL,
        { items: both, penaltyAmount: 100000, penaltyComment: 'Stain' },
        makeUser(StaffRole.SELLER),
      );
      expect(Number(res.newTotalAmount)).toBe(2100000);
      expect(Number(res.dueAmount)).toBe(100000);
      // actualDays depends on the time of day here; covered in rental-return.spec
      expect(res.items[0]).toMatchObject({ plannedDays: 4 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.rentalReturn.create).not.toHaveBeenCalled();
    });

    it('returns only issued items', async () => {
      prisma.rental.findUniqueOrThrow.mockResolvedValue(
        returnable({ status: RentalStatus.BOOKED }),
      );
      await expect(
        service.createReturn(
          RENTAL,
          { items: both },
          makeUser(StaffRole.OWNER),
        ),
      ).rejects.toThrow('Only issued items');
    });
  });

  describe('cancel', () => {
    beforeEach(() => {
      prisma.rental.findUniqueOrThrow.mockResolvedValue({
        status: RentalStatus.BOOKED,
        order: { paidAmount: D(500000) },
      });
    });

    it('manager cancels and gives part of the prepayment back (scenario 8)', async () => {
      await service.cancel(
        RENTAL,
        {
          refundAmount: 300000,
          refundPaymentType: PaymentType.CASH,
          reason: 'Wedding cancelled',
        },
        makeUser(StaffRole.MANAGER),
      );
      expect(prisma.cashTransaction.create.mock.calls[0][0].data).toMatchObject(
        {
          type: CashTransactionType.EXPENSE,
          category: CashTransactionCategory.RETURN,
        },
      );
      const order = prisma.order.update.mock.calls[0][0].data;
      expect(order.status).toBe(OrderStatus.CANCELLED);
      expect(Number(order.paidAmount)).toBe(200000);
      expect(prisma.rental.update.mock.calls[0][0].data).toMatchObject({
        status: RentalStatus.CANCELLED,
        cancelledBy: 'staff',
        cancelReason: 'Wedding cancelled',
      });
    });

    it('forbids a seller to cancel', async () => {
      await expect(
        service.cancel(RENTAL, { refundAmount: 0 }, makeUser(StaffRole.SELLER)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refunds no more than paid and cancels only a booked rental', async () => {
      await expect(
        service.cancel(
          RENTAL,
          { refundAmount: 500001, refundPaymentType: PaymentType.CASH },
          makeUser(StaffRole.OWNER),
        ),
      ).rejects.toThrow('cannot exceed the amount paid');
      prisma.rental.findUniqueOrThrow.mockResolvedValue({
        status: RentalStatus.ISSUED,
        order: { paidAmount: D(0) },
      });
      await expect(
        service.cancel(RENTAL, { refundAmount: 0 }, makeUser(StaffRole.OWNER)),
      ).rejects.toThrow('Only a booked rental');
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('cancels without a refund and without a cashbox', async () => {
      await service.cancel(
        RENTAL,
        { refundAmount: 0 },
        makeUser(StaffRole.OWNER),
      );
      expect(prisma.cashbox.findMany).not.toHaveBeenCalled();
      expect(prisma.cashTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('returnCollateral', () => {
    const state = (status: RentalStatus, total: number, paid: number) => ({
      status,
      order: { totalAmount: D(total), paidAmount: D(paid) },
    });

    beforeEach(() => {
      prisma.rentalCollateral.findFirst.mockResolvedValue({
        id: 'collateral',
        returnedAt: null,
      });
    });

    it('gives the passport back after full payment (R5)', async () => {
      prisma.rental.findUniqueOrThrow.mockResolvedValue(
        state(RentalStatus.RETURNED, 1600000, 1600000),
      );
      await service.returnCollateral(
        RENTAL,
        'collateral',
        makeUser(StaffRole.SELLER),
      );
      expect(
        prisma.rentalCollateral.update.mock.calls[0][0].data,
      ).toMatchObject({
        returnedBy: 'staff',
      });
    });

    it('keeps it while something is owed', async () => {
      prisma.rental.findUniqueOrThrow.mockResolvedValue(
        state(RentalStatus.ISSUED, 1600000, 1500000),
      );
      await expect(
        service.returnCollateral(
          RENTAL,
          'collateral',
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toThrow('after full payment');
    });

    it('gives it back for a cancelled booking', async () => {
      prisma.rental.findUniqueOrThrow.mockResolvedValue(
        state(RentalStatus.CANCELLED, 1600000, 200000),
      );
      await service.returnCollateral(
        RENTAL,
        'collateral',
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.rentalCollateral.update).toHaveBeenCalled();
    });

    it('rejects a collateral returned already', async () => {
      prisma.rental.findUniqueOrThrow.mockResolvedValue(
        state(RentalStatus.RETURNED, 1, 1),
      );
      prisma.rentalCollateral.findFirst.mockResolvedValue({
        id: 'collateral',
        returnedAt: new Date(),
      });
      await expect(
        service.returnCollateral(
          RENTAL,
          'collateral',
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toThrow('already returned');
    });
  });

  describe('getCleaningConflicts', () => {
    const OTHER = '99999999-9999-4999-8999-999999999999';
    const returnedAt = rentalBoundary('2027-05-16');

    beforeEach(() => {
      prisma.rental.findUnique.mockResolvedValue({
        id: RENTAL,
        storeId: STORE,
        warehouseId: WAREHOUSE,
        status: RentalStatus.ISSUED,
        startDate: rentalBoundary('2027-05-14'),
        endDate: rentalBoundary('2027-05-16'),
        order: {
          items: [
            {
              id: 'dress-item',
              variantId: DRESS,
              quantity: 1,
              rentalReturnItems: [],
            },
          ],
        },
      });
      prisma.inventory.findFirst.mockResolvedValue({ quantity: 1 });
      // Next customer takes the only dress on the 17th
      availability.findOccupancy.mockResolvedValue([
        {
          variantId: DRESS,
          rentalId: OTHER,
          from: rentalBoundary('2027-05-17'),
          to: rentalBoundary('2027-05-19'),
          quantity: 1,
        },
      ]);
      prisma.rental.findMany.mockResolvedValue([
        {
          id: OTHER,
          orderId: 'other-order',
          startDate: rentalBoundary('2027-05-17'),
          endDate: rentalBoundary('2027-05-19'),
          order: { customer: { user: { fullName: 'Next bride' } } },
        },
      ]);
    });

    it('warns when cleaning runs into the next booking', async () => {
      const [res] = await service.getCleaningConflicts(
        RENTAL,
        { returnedAt: returnedAt.toISOString(), items: 'dress-item:1:2' },
        makeUser(StaffRole.SELLER),
      );
      expect(res.availableFrom).toEqual(rentalBoundary('2027-05-18'));
      expect(res.conflicts).toEqual([
        expect.objectContaining({
          rentalId: OTHER,
          customerName: 'Next bride',
          startDate: '2027-05-17',
          quantity: 1,
          availableAtStart: 0,
        }),
      ]);
    });

    it('sees no conflict when cleaning ends before the next booking', async () => {
      const [res] = await service.getCleaningConflicts(
        RENTAL,
        { returnedAt: returnedAt.toISOString(), items: 'dress-item:1:1' },
        makeUser(StaffRole.SELLER),
      );
      expect(res.conflicts).toEqual([]);
    });

    it('rejects a malformed items list', async () => {
      await expect(
        service.getCleaningConflicts(
          RENTAL,
          { items: 'dress-item:x:1' },
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toThrow('orderItemId:quantity:cleaningDays');
    });
  });
});
