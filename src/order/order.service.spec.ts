import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { OrderStatus, StaffRole, UserRole, UserType } from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import {
  CreateOrderItemDto,
  CreateOrderPaymentDto,
} from './dto/create-order.dto';
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
    inventory: { findMany: jest.fn(), updateMany: jest.fn() },
    orderItem: { create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
    cashbox: { findFirst: jest.fn(), update: jest.fn() },
    payment: { createMany: jest.fn() },
    cashTransaction: { createMany: jest.fn() },
    stockMovement: { createMany: jest.fn() },
    customer: { findUnique: jest.fn() },
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
        product: { isArchived: false },
      },
    ]);
    prisma.inventory.findMany.mockResolvedValue([
      { variantId: VARIANT, quantity: 10 },
    ]);
    prisma.inventory.updateMany.mockResolvedValue({ count: 1 });
    prisma.cashbox.findFirst.mockResolvedValue({ id: 'cashbox' });
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER });

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
        status: { in: [OrderStatus.COMPLETED, OrderStatus.DEBT] },
        soldAt: { gte: new Date(range.from), lt: new Date(range.to) },
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
  });
});
