import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import {
  OrderStatus,
  ReturnOrderStatus,
  StaffRole,
  UserRole,
  UserType,
} from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import {
  CreateOrderItemDto,
  CreateOrderPaymentDto,
} from './dto/create-order.dto';
import { CreateReturnOrderDto } from './dto/create-return.dto';
import { OrderService } from './order.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const FOREIGN_STORE = '22222222-2222-4222-8222-222222222222';
const WAREHOUSE = '33333333-3333-4333-8333-333333333333';
const ORDER = '44444444-4444-4444-8444-444444444444';
const VARIANT = '55555555-5555-4555-8555-555555555555';
const ITEM = '66666666-6666-4666-8666-666666666666';
const CUSTOMER = '77777777-7777-4777-8777-777777777777';

function makeUser(
  staffRole: StaffRole,
  overrides: Partial<CurrentUser> = {},
): CurrentUser {
  return {
    id: 'user',
    role: staffRole === StaffRole.OWNER ? UserRole.OWNER : UserRole.USER,
    type: UserType.STAFF,
    staff: {
      id: 'seller-staff',
      storeId: STORE,
      role: staffRole,
      warehouse: [{ warehouseId: WAREHOUSE }],
    },
    ...overrides,
  } as unknown as CurrentUser;
}

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER,
    storeId: STORE,
    warehouseId: WAREHOUSE,
    cashierId: 'seller-staff',
    customerId: null,
    status: OrderStatus.HOLD,
    totalAmount: 100000,
    items: [],
    services: [],
    payments: [],
    rental: null,
    store: { salesEnabled: true },
    ...overrides,
  };
}

function itemsDto(
  items: Partial<CreateOrderItemDto['items'][number]>[],
  extra: Partial<CreateOrderItemDto> = {},
) {
  return {
    orderId: ORDER,
    additionalServices: [],
    items: items.map((i) => ({
      variantId: VARIANT,
      quantity: 1,
      retailPrice: 100000,
      sale: 0,
      costAtSale: 60000,
      ...i,
    })),
    ...extra,
  } as CreateOrderItemDto;
}

describe('OrderService', () => {
  let service: OrderService;
  const prisma = {
    $transaction: jest.fn(),
    order: { findUnique: jest.fn(), update: jest.fn(), aggregate: jest.fn() },
    productVariant: { findMany: jest.fn() },
    inventory: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
    },
    orderItem: { create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
    additionalService: {
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    cashbox: { findFirst: jest.fn(), update: jest.fn() },
    payment: { createMany: jest.fn() },
    cashTransaction: { createMany: jest.fn() },
    stockMovement: { createMany: jest.fn(), findMany: jest.fn() },
    customer: { findUnique: jest.fn() },
    returnedOrder: { create: jest.fn(), update: jest.fn() },
    returnItem: { createMany: jest.fn() },
    returnPayment: { createMany: jest.fn() },
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
    prisma.order.findUnique.mockResolvedValue(makeOrder());
    prisma.productVariant.findMany.mockResolvedValue([
      {
        id: VARIANT,
        storeId: STORE,
        price: 100000,
        canSell: true,
        product: { isArchived: false },
      },
    ]);
    prisma.inventory.findMany.mockResolvedValue([
      { variantId: VARIANT, quantity: 10 },
    ]);
    prisma.inventory.updateMany.mockResolvedValue({ count: 1 });
    prisma.cashbox.findFirst.mockResolvedValue({ id: 'cashbox' });
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER });
    prisma.stockMovement.findMany.mockResolvedValue([
      { variantId: VARIANT, unitCost: 55000 },
    ]);
    prisma.returnedOrder.create.mockResolvedValue({ id: 'return' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: getLoggerToken(OrderService.name), useValue: logger },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
  });

  describe('createOrderItems', () => {
    it('saves items for the seller who owns the order', async () => {
      await service.createOrderItems(
        itemsDto([{}]),
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.orderItem.create).toHaveBeenCalledTimes(1);
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            totalAmount: 100000,
            status: OrderStatus.HOLD,
          }),
        }),
      );
    });

    it('takes the cost from the latest stock receipt, not from the request', async () => {
      await service.createOrderItems(
        // An old client still sends its own cost
        itemsDto([
          { costAtSale: 1 } as Partial<CreateOrderItemDto['items'][number]>,
        ]),
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.orderItem.create.mock.calls[0][0].data.costAtSale).toBe(
        55000,
      );
    });

    it('keeps the cost of a saved line', async () => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({
          items: [
            {
              id: ITEM,
              variantId: VARIANT,
              quantity: 1,
              retailPrice: 100000,
              sale: 0,
              costAtSale: 40000,
            },
          ],
        }),
      );
      await service.createOrderItems(
        itemsDto([{ itemId: ITEM, quantity: 2 }]),
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.orderItem.update.mock.calls[0][0].data.costAtSale).toBe(
        40000,
      );
    });

    it('rejects an order of another store', async () => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({ storeId: FOREIGN_STORE }),
      );
      await expect(
        service.createOrderItems(itemsDto([{}]), makeUser(StaffRole.MANAGER)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejects a seller editing another seller's order", async () => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({ cashierId: 'other-staff' }),
      );
      await expect(
        service.createOrderItems(itemsDto([{}]), makeUser(StaffRole.SELLER)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("lets a manager edit a seller's order", async () => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({ cashierId: 'other-staff' }),
      );
      await expect(
        service.createOrderItems(itemsDto([{}]), makeUser(StaffRole.MANAGER)),
      ).resolves.toBeDefined();
    });

    it('rejects a new line of an archived product but keeps a saved one', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        {
          id: VARIANT,
          storeId: STORE,
          price: 100000,
          canSell: true,
          product: { isArchived: true },
        },
      ]);
      await expect(
        service.createOrderItems(itemsDto([{}]), makeUser(StaffRole.SELLER)),
      ).rejects.toBeInstanceOf(BadRequestException);

      prisma.order.findUnique.mockResolvedValue(
        makeOrder({
          items: [
            {
              id: ITEM,
              variantId: VARIANT,
              retailPrice: 100000,
              sale: 0,
              quantity: 1,
            },
          ],
        }),
      );
      await expect(
        service.createOrderItems(
          itemsDto([{ itemId: ITEM }]),
          makeUser(StaffRole.SELLER),
        ),
      ).resolves.toBeDefined();
    });

    it('forbids a seller to lower the price', async () => {
      await expect(
        service.createOrderItems(
          itemsDto([{ sale: 5000 }]),
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.createOrderItems(
          itemsDto([{ retailPrice: 90000 }]),
          makeUser(StaffRole.CASHIER),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('lets a seller raise the price', async () => {
      await expect(
        service.createOrderItems(
          itemsDto([{ retailPrice: 110000 }]),
          makeUser(StaffRole.SELLER),
        ),
      ).resolves.toBeDefined();
    });

    it('lets an owner and a manager lower the price', async () => {
      await expect(
        service.createOrderItems(
          itemsDto([{ sale: 5000 }]),
          makeUser(StaffRole.OWNER),
        ),
      ).resolves.toBeDefined();
      await expect(
        service.createOrderItems(
          itemsDto([{ sale: 5000 }]),
          makeUser(StaffRole.MANAGER),
        ),
      ).resolves.toBeDefined();
    });

    it('keeps a discount a manager already saved when a seller re-saves the order', async () => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({
          items: [
            { id: ITEM, variantId: VARIANT, retailPrice: 100000, sale: 5000 },
          ],
        }),
      );
      await expect(
        service.createOrderItems(
          itemsDto([{ itemId: ITEM, sale: 5000, quantity: 2 }]),
          makeUser(StaffRole.SELLER),
        ),
      ).resolves.toBeDefined();
      await expect(
        service.createOrderItems(
          itemsDto([{ itemId: ITEM, sale: 8000 }]),
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a discount larger than the price', async () => {
      await expect(
        service.createOrderItems(
          itemsDto([{ sale: 120000 }]),
          makeUser(StaffRole.OWNER),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('keeps the customer when customerId is omitted and clears it on null', async () => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({ customerId: CUSTOMER }),
      );
      await service.createOrderItems(
        itemsDto([{}]),
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.order.update.mock.calls[0][0].data.customerId).toBe(
        CUSTOMER,
      );

      await service.createOrderItems(
        itemsDto([{}], { customerId: null as unknown as string }),
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.order.update.mock.calls[1][0].data.customerId).toBeNull();
    });

    it('does not update an item that belongs to another order', async () => {
      await service.createOrderItems(
        itemsDto([{ itemId: ITEM }]),
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.orderItem.update).not.toHaveBeenCalled();
      expect(prisma.orderItem.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('createPayment', () => {
    const payDto = (amount: number, customerId?: string) =>
      ({
        orderId: ORDER,
        customerId,
        payments: [{ type: 'CASH', amount, paidAt: null }],
      }) as CreateOrderPaymentDto;

    it('completes a fully paid order without a customer', async () => {
      await service.createPayment(
        ORDER,
        payDto(100000),
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: OrderStatus.COMPLETED,
            customerId: null,
          }),
        }),
      );
    });

    it('rejects an order of another store', async () => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({ storeId: FOREIGN_STORE }),
      );
      await expect(
        service.createPayment(
          ORDER,
          payDto(100000),
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.payment.createMany).not.toHaveBeenCalled();
    });

    it('stamps soldAt on the sale', async () => {
      await service.createPayment(
        ORDER,
        payDto(100000),
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.order.update.mock.calls[0][0].data.soldAt).toBeInstanceOf(
        Date,
      );
    });

    it('rejects a DEBT order so stock is not deducted twice', async () => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({ status: OrderStatus.DEBT, customerId: CUSTOMER }),
      );
      await expect(
        service.createPayment(
          ORDER,
          payDto(10000, CUSTOMER),
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.inventory.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a partial payment without a customer', async () => {
      await expect(
        service.createPayment(ORDER, payDto(40000), makeUser(StaffRole.SELLER)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('leaves the rest as debt for the given customer', async () => {
      await service.createPayment(
        ORDER,
        payDto(40000, CUSTOMER),
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: OrderStatus.DEBT,
            customerId: CUSTOMER,
            paidAmount: 40000,
          }),
        }),
      );
    });

    it('sells fully on debt without zero payment records', async () => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({
          items: [
            {
              variantId: VARIANT,
              quantity: 1,
              costAtSale: 55000,
              variant: { canSell: true },
            },
          ],
        }),
      );
      await service.createPayment(
        ORDER,
        payDto(0, CUSTOMER),
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.payment.createMany.mock.calls[0][0].data).toEqual([]);
      expect(prisma.cashTransaction.createMany.mock.calls[0][0].data).toEqual(
        [],
      );
      expect(prisma.inventory.updateMany).toHaveBeenCalled();
      expect(prisma.order.update.mock.calls[0][0].data.status).toBe(
        OrderStatus.DEBT,
      );
    });

    it('keeps the customer already attached to the order', async () => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({ customerId: CUSTOMER }),
      );
      await service.createPayment(
        ORDER,
        payDto(40000),
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.order.update.mock.calls[0][0].data.customerId).toBe(
        CUSTOMER,
      );
    });

    it('rejects an overpayment', async () => {
      await expect(
        service.createPayment(
          ORDER,
          payDto(150000),
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('createReturn', () => {
    const orderLine = {
      id: ITEM,
      variantId: VARIANT,
      quantity: 2,
      retailPrice: 50000,
      sale: 10000,
      costAtSale: 30000,
    };
    const returnDto = (
      quantity: number,
      payout = 0,
      extra: Record<string, unknown> = {},
    ) =>
      ({
        orderId: ORDER,
        items: [{ itemId: ITEM, quantity, ...extra }],
        returnPayments: payout ? [{ type: 'CASH', amount: payout }] : [],
      }) as unknown as CreateReturnOrderDto;
    const paidOrder = (overrides: Record<string, unknown> = {}) =>
      makeOrder({
        status: OrderStatus.COMPLETED,
        totalAmount: 80000,
        isReturned: false,
        items: [orderLine],
        payments: [{ amount: 80000 }],
        ...overrides,
      });

    beforeEach(() => {
      prisma.order.findUnique.mockResolvedValue(paidOrder());
    });

    it('puts the goods back on the order warehouse', async () => {
      await service.createReturn(
        returnDto(2, 80000),
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.inventory.upsert).toHaveBeenCalledWith({
        where: {
          warehouseId_variantId: { warehouseId: WAREHOUSE, variantId: VARIANT },
        },
        update: { quantity: { increment: 2 } },
        create: { warehouseId: WAREHOUSE, variantId: VARIANT, quantity: 2 },
      });
      expect(
        prisma.stockMovement.createMany.mock.calls[0][0].data[0].unitCost,
      ).toBe(30000);
    });

    it('returns a fully paid order in full', async () => {
      await service.createReturn(
        returnDto(2, 80000),
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.returnedOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: ReturnOrderStatus.COMPLETED },
        }),
      );
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: OrderStatus.REFUNDED,
            returnedAmount: 80000,
          }),
        }),
      );
    });

    it('prices the return from the order, ignoring prices in the request', async () => {
      await expect(
        service.createReturn(
          returnDto(1, 90000, { retailPrice: 90000, sale: 0 }),
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      // 50000 - 10000 from the order line, not 90000 from the request
      expect(
        prisma.returnedOrder.create.mock.calls[0][0].data.totalAmount,
      ).toBe(40000);
    });

    it('lets a partly paid debt order be returned in full and pays back what was paid', async () => {
      prisma.order.findUnique.mockResolvedValue(
        paidOrder({ status: OrderStatus.DEBT, payments: [{ amount: 30000 }] }),
      );
      await service.createReturn(
        returnDto(2, 30000),
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.returnedOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: ReturnOrderStatus.COMPLETED },
        }),
      );
    });

    it('rejects an order of another store', async () => {
      prisma.order.findUnique.mockResolvedValue(
        paidOrder({ storeId: FOREIGN_STORE }),
      );
      await expect(
        service.createReturn(returnDto(1), makeUser(StaffRole.SELLER)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects the same line twice', async () => {
      const dto = returnDto(1);
      dto.items.push({ itemId: ITEM, quantity: 1 });
      await expect(
        service.createReturn(dto, makeUser(StaffRole.SELLER)),
      ).rejects.toThrow('Duplicate return item');
    });
  });

  describe('findOne', () => {
    beforeEach(() => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({
          items: [
            {
              id: ITEM,
              costAtSale: 55000,
              variant: { id: VARIANT, inventory: [{ quantity: 4 }] },
            },
          ],
        }),
      );
    });

    it('hides the purchase cost from a seller', async () => {
      const order = await service.findOne(ORDER, makeUser(StaffRole.SELLER));
      expect(order.items[0]).not.toHaveProperty('costAtSale');
      expect(order.items[0].variant.quantity).toBe(4);
    });

    it('shows the purchase cost to a manager', async () => {
      const order = await service.findOne(ORDER, makeUser(StaffRole.MANAGER));
      expect(order.items[0]).toHaveProperty('costAtSale', 55000);
    });
  });

  describe('clearCustomerFromOrder', () => {
    it('rejects an order of another store', async () => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({ storeId: FOREIGN_STORE }),
      );
      await expect(
        service.clearCustomerFromOrder(ORDER, makeUser(StaffRole.SELLER)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('getSummary', () => {
    const range = {
      from: '2026-10-20T19:00:00.000Z',
      to: '2026-10-21T19:00:00.000Z',
    };

    beforeEach(() => {
      prisma.order.aggregate.mockResolvedValue({
        _count: { _all: 3 },
        _sum: { totalAmount: '300000', paidAmount: '220000' },
      });
    });

    it('sums orders sold in the period and derives the debt', async () => {
      const res = await service.getSummary(range, makeUser(StaffRole.OWNER));
      const where = prisma.order.aggregate.mock.calls[0][0].where;
      expect(where).toEqual({
        soldAt: { gte: new Date(range.from), lt: new Date(range.to) },
        OR: [
          { status: { in: [OrderStatus.COMPLETED, OrderStatus.DEBT] } },
          // An issued rental counts from soldAt while still HOLD (R6)
          { status: OrderStatus.HOLD, rental: { isNot: null } },
        ],
        storeId: STORE,
      });
      expect(res).toMatchObject({
        count: 3,
        total: 300000,
        paid: 220000,
        debt: 80000,
      });
    });

    it('limits a manager to their warehouses and a seller to own sales', async () => {
      await service.getSummary(range, makeUser(StaffRole.MANAGER));
      expect(prisma.order.aggregate.mock.calls[0][0].where).toMatchObject({
        warehouseId: { in: [WAREHOUSE] },
      });
      await service.getSummary(range, makeUser(StaffRole.SELLER));
      expect(prisma.order.aggregate.mock.calls[1][0].where).toMatchObject({
        cashierId: 'seller-staff',
      });
      expect(prisma.order.aggregate.mock.calls[1][0].where).not.toHaveProperty(
        'warehouseId',
      );
    });

    it('narrows a manager to the working warehouse', async () => {
      await service.getSummary(
        { ...range, warehouseId: WAREHOUSE },
        makeUser(StaffRole.MANAGER),
      );
      expect(prisma.order.aggregate.mock.calls[0][0].where).toMatchObject({
        storeId: STORE,
        warehouseId: WAREHOUSE,
      });
    });

    it('rejects a warehouse the employee has no access to', async () => {
      await expect(
        service.getSummary(
          { ...range, warehouseId: '44444444-4444-4444-8444-444444444444' },
          makeUser(StaffRole.SELLER),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.order.aggregate).not.toHaveBeenCalled();
    });
  });
  describe('rental orders and sale flags', () => {
    const rentalOrder = (overrides: Record<string, unknown> = {}) =>
      makeOrder({
        rental: { id: 'rental' },
        customerId: CUSTOMER,
        ...overrides,
      });

    it('rejects editing items of a rental order', async () => {
      prisma.order.findUnique.mockResolvedValue(rentalOrder());
      await expect(
        service.createOrderItems(itemsDto([{}]), makeUser(StaffRole.OWNER)),
      ).rejects.toThrow('rental order');
      expect(prisma.orderItem.create).not.toHaveBeenCalled();
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('rejects paying a rental order without touching stock', async () => {
      prisma.order.findUnique.mockResolvedValue(
        rentalOrder({
          items: [
            {
              variantId: VARIANT,
              quantity: 1,
              costAtSale: 55000,
              variant: { canSell: true },
            },
          ],
        }),
      );
      await expect(
        service.createPayment(
          ORDER,
          {
            orderId: ORDER,
            payments: [{ type: 'CASH', amount: 100000, paidAt: null }],
          } as CreateOrderPaymentDto,
          makeUser(StaffRole.OWNER),
        ),
      ).rejects.toThrow('rental order');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.inventory.updateMany).not.toHaveBeenCalled();
      expect(prisma.stockMovement.createMany).not.toHaveBeenCalled();
    });

    it('rejects a sale return of a rental order', async () => {
      prisma.order.findUnique.mockResolvedValue(
        rentalOrder({ status: OrderStatus.COMPLETED, isReturned: false }),
      );
      await expect(
        service.createReturn(
          {
            orderId: ORDER,
            items: [{ itemId: ITEM, quantity: 1 }],
            returnPayments: [],
          } as unknown as CreateReturnOrderDto,
          makeUser(StaffRole.OWNER),
        ),
      ).rejects.toThrow('rental order');
      expect(prisma.returnedOrder.create).not.toHaveBeenCalled();
      expect(prisma.inventory.upsert).not.toHaveBeenCalled();
    });

    it('rejects cancelling a rental order via the sale flow', async () => {
      prisma.order.findUnique.mockResolvedValue(rentalOrder());
      await expect(
        service.remove(ORDER, makeUser(StaffRole.OWNER)),
      ).rejects.toThrow('rental order');
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('rejects clearing the customer of a rental order', async () => {
      prisma.order.findUnique.mockResolvedValue(rentalOrder());
      await expect(
        service.clearCustomerFromOrder(ORDER, makeUser(StaffRole.OWNER)),
      ).rejects.toThrow('rental order');
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('rejects a variant that is not for sale', async () => {
      prisma.productVariant.findMany.mockResolvedValue([
        {
          id: VARIANT,
          storeId: STORE,
          price: 100000,
          canSell: false,
          product: { isArchived: false },
        },
      ]);
      await expect(
        service.createOrderItems(itemsDto([{}]), makeUser(StaffRole.OWNER)),
      ).rejects.toThrow('not for sale');
      expect(prisma.orderItem.create).not.toHaveBeenCalled();
    });

    it('rejects paying for a variant that is no longer for sale', async () => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({
          items: [
            {
              variantId: VARIANT,
              quantity: 1,
              costAtSale: 55000,
              variant: { canSell: false },
            },
          ],
        }),
      );
      await expect(
        service.createPayment(
          ORDER,
          {
            orderId: ORDER,
            payments: [{ type: 'CASH', amount: 100000, paidAt: null }],
          } as CreateOrderPaymentDto,
          makeUser(StaffRole.OWNER),
        ),
      ).rejects.toThrow('not for sale');
      expect(prisma.inventory.updateMany).not.toHaveBeenCalled();
    });

    it('rejects selling in a store with sales disabled', async () => {
      prisma.order.findUnique.mockResolvedValue(
        makeOrder({ store: { salesEnabled: false } }),
      );
      await expect(
        service.createOrderItems(itemsDto([{}]), makeUser(StaffRole.OWNER)),
      ).rejects.toThrow('Sales are disabled');
      expect(prisma.orderItem.create).not.toHaveBeenCalled();
    });

    it('subtracts the service discount from the order total', async () => {
      await service.createOrderItems(
        itemsDto([{}], {
          additionalServices: [{ name: 'Доставка', price: 20000, sale: 5000 }],
        }),
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.additionalService.create.mock.calls[0][0].data.sale).toBe(
        5000,
      );
      expect(prisma.order.update.mock.calls[0][0].data.totalAmount).toBe(
        115000,
      );
    });

    it('treats a service without a discount as sale 0', async () => {
      await service.createOrderItems(
        itemsDto([{}], {
          additionalServices: [{ name: 'Доставка', price: 20000 }],
        }),
        makeUser(StaffRole.SELLER),
      );
      expect(prisma.additionalService.create.mock.calls[0][0].data.sale).toBe(
        0,
      );
      expect(prisma.order.update.mock.calls[0][0].data.totalAmount).toBe(
        120000,
      );
    });

    it('rejects a service discount larger than its price', async () => {
      await expect(
        service.createOrderItems(
          itemsDto([{}], {
            additionalServices: [
              { name: 'Доставка', price: 20000, sale: 25000 },
            ],
          }),
          makeUser(StaffRole.OWNER),
        ),
      ).rejects.toThrow('service price');
      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });
});
