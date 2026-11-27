import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { Prisma } from '@generated/client';
import {
  OnlineOrderStatus,
  OrderChannel,
  StaffRole,
  UserRole,
  UserType,
} from '@generated/enums';
import type { CurrentUser } from '@auth/models/auth.model';
import type { OrderService } from '@order/order.service';
import type { PrismaService } from '@prisma/prisma.service';
import type { UserService } from '@user/user.service';
import {
  ConfirmOnlineOrderDto,
  OnlineOrderListParams,
  RejectOnlineOrderDto,
} from './dto/online-order.dto';
import { findShortages, OnlineOrderService } from './online-order.service';
import type { TelegramBotClient } from './telegram-bot.client';
import {
  INSUFFICIENT_STOCK,
  ITEMS_UNAVAILABLE,
  ONLINE_ORDER_ALREADY_HANDLED,
} from './telegram.constants';
import type { TokenCryptoService } from './token-crypto.service';

const STORE = 'store-1';
const OTHER_STORE = 'store-2';
const W1 = '11111111-1111-4111-8111-111111111111';
const W2 = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const V1 = 'variant-1';
const V2 = 'variant-2';
const D = (value: string | number) => new Prisma.Decimal(value);

const staffUser = (
  role: StaffRole,
  warehouses: string[],
  userRole: UserRole = UserRole.USER,
) =>
  ({
    id: 'user-1',
    role: userRole,
    type: UserType.STAFF,
    staff: {
      id: 'staff-1',
      storeId: STORE,
      role,
      warehouse: warehouses.map((warehouseId) => ({ warehouseId })),
    },
  }) as unknown as CurrentUser;

const seller = staffUser(StaffRole.SELLER, [W1]);
const owner = staffUser(StaffRole.OWNER, [W1, W2], UserRole.OWNER);

const confirmDto = (warehouseId = W1) =>
  Object.assign(new ConfirmOnlineOrderDto(), { warehouseId });
const rejectDto = (reason?: string) =>
  Object.assign(new RejectOnlineOrderDto(), { reason });

const variantRow = (overrides: Record<string, unknown> = {}) => ({
  storeId: STORE,
  price: D('1300000'),
  canSell: true,
  attributes: [
    { value: { valueString: null, valueNumber: D('6'), valueBool: null } },
  ],
  product: { name: 'Strapela', isArchived: false },
  ...overrides,
});

const requestRow = (overrides: Record<string, unknown> = {}) => ({
  id: REQUEST,
  storeId: STORE,
  number: 12,
  telegramUserId: '4242',
  fullName: 'Ali Valiyev',
  phone: '+998901234567',
  region: 'samarkand',
  district: 'Urgut',
  comment: null,
  status: OnlineOrderStatus.NEW,
  orderId: null,
  customerId: null,
  handledById: null,
  handledAt: null,
  rejectReason: null,
  createdAt: new Date('2026-11-27T10:00:00Z'),
  items: [
    { variantId: V1, quantity: 2, variant: variantRow() },
    {
      variantId: V2,
      quantity: 1,
      variant: variantRow({
        price: D('500000'),
        product: { name: 'Zherd', isArchived: false },
        attributes: [],
      }),
    },
  ],
  ...overrides,
});

describe('OnlineOrderService', () => {
  let prisma: Record<string, any>;
  let orders: { create: jest.Mock; createOrderItems: jest.Mock };
  let users: { ensureStoreCustomer: jest.Mock };
  let client: { sendMessage: jest.Mock };
  let crypto: { decrypt: jest.Mock };
  let logger: { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let service: OnlineOrderService;

  beforeEach(() => {
    prisma = {
      onlineOrder: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(requestRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      warehouse: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: W1 }),
      },
      inventory: {
        findMany: jest.fn().mockResolvedValue([
          { warehouseId: W1, variantId: V1, quantity: 5 },
          { warehouseId: W1, variantId: V2, quantity: 3 },
        ]),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      customer: { findUnique: jest.fn().mockResolvedValue(null) },
      staff: { findUnique: jest.fn().mockResolvedValue(null) },
      storeTelegramBot: {
        findUnique: jest.fn().mockResolvedValue({
          botTokenEnc: 'v1:enc',
          store: { name: 'Baraka' },
        }),
      },
      orderItem: { deleteMany: jest.fn().mockResolvedValue({}) },
      additionalService: { deleteMany: jest.fn().mockResolvedValue({}) },
      order: { delete: jest.fn().mockResolvedValue({}) },
      $transaction: jest
        .fn()
        .mockImplementation((arg: unknown) =>
          Array.isArray(arg)
            ? Promise.all(arg)
            : (arg as (tx: unknown) => unknown)(prisma),
        ),
    };
    orders = {
      create: jest.fn().mockResolvedValue({ id: 'order-1' }),
      createOrderItems: jest.fn().mockResolvedValue({ message: 'ok' }),
    };
    users = {
      ensureStoreCustomer: jest
        .fn()
        .mockResolvedValue({ customerId: 'cust-1', created: true }),
    };
    client = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    crypto = { decrypt: jest.fn().mockReturnValue('123456789:TOKEN') };
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service = new OnlineOrderService(
      prisma as unknown as PrismaService,
      orders as unknown as OrderService,
      users as unknown as UserService,
      client as unknown as TelegramBotClient,
      crypto as unknown as TokenCryptoService,
      logger as unknown as PinoLogger,
    );
  });

  describe('access', () => {
    it('refuses a user without a store (platform ADMIN) everywhere', async () => {
      const admin = {
        id: 'a',
        role: UserRole.ADMIN,
        staff: null,
      } as unknown as CurrentUser;

      await expect(
        service.list(new OnlineOrderListParams(), admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.findOne(REQUEST, admin)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.confirm(REQUEST, confirmDto(), admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.reject(REQUEST, rejectDto(), admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('list', () => {
    it('is scoped to the employee’s store and counts every status', async () => {
      prisma.onlineOrder.groupBy.mockResolvedValue([
        { status: OnlineOrderStatus.NEW, _count: { _all: 3 } },
        { status: OnlineOrderStatus.REJECTED, _count: { _all: 1 } },
      ]);
      prisma.onlineOrder.findMany.mockResolvedValue([
        requestRow({
          items: [
            { quantity: 2, priceAtRequest: D('1200000') },
            { quantity: 1, priceAtRequest: D('500000') },
          ],
        }),
      ]);
      prisma.onlineOrder.count.mockResolvedValue(1);

      const result = await service.list(
        Object.assign(new OnlineOrderListParams(), {
          status: OnlineOrderStatus.NEW,
        }),
        seller,
      );

      expect(prisma.onlineOrder.findMany.mock.calls[0][0].where).toEqual({
        storeId: STORE,
        status: OnlineOrderStatus.NEW,
      });
      expect(prisma.onlineOrder.groupBy.mock.calls[0][0].where).toEqual({
        storeId: STORE,
      });
      expect(result.counts).toEqual({ NEW: 3, CONFIRMED: 0, REJECTED: 1 });
      expect(result.data[0]).toMatchObject({
        id: REQUEST,
        number: 12,
        regionName: 'Самаркандская область',
        itemsCount: 2,
        total: '2900000',
      });
    });

    it('turns query strings into numbers and caps the page size', async () => {
      const params = Object.assign(new OnlineOrderListParams(), {
        currentPage: '2' as unknown as number,
        pageSize: '500' as unknown as number,
      });

      const result = await service.list(params, seller);

      expect(result).toMatchObject({ currentPage: 2, pageSize: 50 });
      expect(prisma.onlineOrder.findMany.mock.calls[0][0]).toMatchObject({
        skip: 50,
        take: 50,
      });
    });
  });

  describe('findOne', () => {
    const detailRow = (overrides: Record<string, unknown> = {}) =>
      requestRow({
        items: [
          {
            variantId: V1,
            quantity: 2,
            priceAtRequest: D('1200000'),
            variant: {
              ...variantRow(),
              product: {
                name: 'Strapela',
                isArchived: false,
                images: [{ key: 'products/store-1/a.jpg' }],
              },
            },
          },
          {
            variantId: V2,
            quantity: 1,
            priceAtRequest: D('500000'),
            variant: {
              ...variantRow({
                canSell: false,
                attributes: [],
                price: D('600000'),
              }),
              product: { name: 'Zherd', isArchived: false, images: [] },
            },
          },
        ],
        ...overrides,
      });

    it('404 for a request of another store: the lookup is by id AND store', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValue(null);

      await expect(service.findOne(REQUEST, seller)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.onlineOrder.findFirst.mock.calls[0][0].where).toEqual({
        id: REQUEST,
        storeId: STORE,
      });
    });

    it('shows lines at both prices, what is no longer for sale and the existing customer', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValue(detailRow());
      prisma.user.findUnique.mockResolvedValue({
        fullName: 'Ali V.',
        customer: { id: 'cust-9' },
      });
      prisma.warehouse.findMany.mockResolvedValue([
        { id: W1, name: 'Склад 1' },
      ]);

      const details = await service.findOne(REQUEST, seller);

      expect(details.items).toEqual([
        {
          variantId: V1,
          label: 'Strapela 6',
          quantity: 2,
          priceAtRequest: '1200000',
          currentPrice: '1300000',
          imageUrl: expect.stringContaining(
            'products/store-1/a.jpg',
          ) as unknown as string,
          available: true,
        },
        {
          variantId: V2,
          label: 'Zherd',
          quantity: 1,
          priceAtRequest: '500000',
          currentPrice: '600000',
          imageUrl: null,
          available: false,
        },
      ]);
      expect(details.total).toBe('2900000');
      expect(details.currentTotal).toBe('3200000');
      expect(details.customer).toEqual({ id: 'cust-9', fullName: 'Ali V.' });
    });

    it('checks each of the seller’s warehouses (only theirs); the owner sees all active ones', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValue(detailRow());
      prisma.warehouse.findMany.mockResolvedValue([
        { id: W1, name: 'Склад 1' },
        { id: W2, name: 'Склад 2' },
      ]);
      prisma.inventory.findMany.mockResolvedValue([
        { warehouseId: W1, variantId: V1, quantity: 5 },
        { warehouseId: W1, variantId: V2, quantity: 1 },
        { warehouseId: W2, variantId: V1, quantity: 1 },
      ]);

      const asOwner = await service.findOne(REQUEST, owner);

      expect(prisma.warehouse.findMany.mock.calls[0][0].where).toEqual({
        storeId: STORE,
        isActive: true,
      });
      expect(asOwner.warehouses).toEqual([
        { id: W1, name: 'Склад 1', enough: true, shortages: [] },
        {
          id: W2,
          name: 'Склад 2',
          enough: false,
          shortages: [
            { variantId: V1, label: 'Strapela 6', requested: 2, available: 1 },
            { variantId: V2, label: 'Zherd', requested: 1, available: 0 },
          ],
        },
      ]);

      await service.findOne(REQUEST, seller);
      expect(prisma.warehouse.findMany.mock.calls[1][0].where).toEqual({
        storeId: STORE,
        isActive: true,
        id: { in: [W1] },
      });
    });

    it('a handled request has no warehouse check and shows who handled it and the linked customer', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValue(
        detailRow({
          status: OnlineOrderStatus.CONFIRMED,
          orderId: 'order-1',
          customerId: 'cust-1',
          handledById: 'staff-7',
        }),
      );
      prisma.customer.findUnique.mockResolvedValue({
        id: 'cust-1',
        user: { fullName: 'Ali Valiyev' },
      });
      prisma.staff.findUnique.mockResolvedValue({
        user: { fullName: 'Продавец Иван' },
      });

      const details = await service.findOne(REQUEST, seller);

      expect(details.warehouses).toEqual([]);
      expect(prisma.warehouse.findMany).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(details).toMatchObject({
        orderId: 'order-1',
        handledBy: 'Продавец Иван',
        customer: { id: 'cust-1', fullName: 'Ali Valiyev' },
      });
    });
  });

  describe('confirm', () => {
    it('creates the customer, takes the request, creates the order at current prices and tells the customer', async () => {
      const result = await service.confirm(REQUEST, confirmDto(), seller);

      expect(users.ensureStoreCustomer).toHaveBeenCalledWith({
        fullName: 'Ali Valiyev',
        phone: '+998901234567',
        storeId: STORE,
      });
      expect(prisma.onlineOrder.updateMany).toHaveBeenCalledWith({
        where: { id: REQUEST, storeId: STORE, status: OnlineOrderStatus.NEW },
        data: {
          status: OnlineOrderStatus.CONFIRMED,
          handledById: 'staff-1',
          handledAt: expect.any(Date) as unknown as Date,
          customerId: 'cust-1',
        },
      });

      const createArg = orders.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(createArg).toMatchObject({
        storeId: STORE,
        warehouseId: W1,
        customerId: 'cust-1',
        channel: OrderChannel.ONLINE,
      });
      expect(orders.create.mock.calls[0][1]).toBe(seller);

      const itemsArg = orders.createOrderItems.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(itemsArg).toMatchObject({
        orderId: 'order-1',
        customerId: 'cust-1',
        additionalServices: [],
        items: [
          { variantId: V1, quantity: 2, retailPrice: 1300000, sale: 0 },
          { variantId: V2, quantity: 1, retailPrice: 500000, sale: 0 },
        ],
      });
      expect(prisma.onlineOrder.update).toHaveBeenCalledWith({
        where: { id: REQUEST },
        data: { orderId: 'order-1' },
      });

      expect(result).toEqual({
        orderId: 'order-1',
        customerId: 'cust-1',
        customerCreated: true,
        customerNotified: true,
      });
      const [token, chat, text] = client.sendMessage.mock.calls[0] as [
        string,
        string,
        string,
      ];
      expect(token).toBe('123456789:TOKEN');
      expect(chat).toBe('4242');
      expect(text).toContain('Заявка №12 принята');
      expect(text).toContain('№12-buyurtma qabul qilindi');
      expect(text).toContain('Baraka');
    });

    it('order of work: customer, then taking the request, then the order, then its lines', async () => {
      await service.confirm(REQUEST, confirmDto(), seller);

      const at = (mock: jest.Mock) => mock.mock.invocationCallOrder[0];
      expect(at(users.ensureStoreCustomer)).toBeLessThan(
        at(prisma.onlineOrder.updateMany),
      );
      expect(at(prisma.onlineOrder.updateMany)).toBeLessThan(at(orders.create));
      expect(at(orders.create)).toBeLessThan(at(orders.createOrderItems));
      expect(at(orders.createOrderItems)).toBeLessThan(
        at(prisma.onlineOrder.update),
      );
    });

    it('403 for a warehouse the seller does not work on, before reading the request', async () => {
      await expect(
        service.confirm(REQUEST, confirmDto(W2), seller),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.onlineOrder.findFirst).not.toHaveBeenCalled();
    });

    it('the owner may pick any warehouse of the store', async () => {
      prisma.warehouse.findFirst.mockResolvedValue({ id: W2 });
      prisma.inventory.findMany.mockResolvedValue([
        { warehouseId: W2, variantId: V1, quantity: 9 },
        { warehouseId: W2, variantId: V2, quantity: 9 },
      ]);

      await service.confirm(REQUEST, confirmDto(W2), owner);

      expect(orders.create.mock.calls[0][0]).toMatchObject({ warehouseId: W2 });
    });

    it('404 for an unknown request or one of another store (lookup by id AND store)', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.confirm(REQUEST, confirmDto(), seller),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.onlineOrder.findFirst.mock.calls[0][0].where).toEqual({
        id: REQUEST,
        storeId: STORE,
      });
    });

    it('409 for a request that is already handled: no customer, no order', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValue(
        requestRow({ status: OnlineOrderStatus.CONFIRMED }),
      );

      await expect(
        service.confirm(REQUEST, confirmDto(), seller),
      ).rejects.toMatchObject({
        response: { code: ONLINE_ORDER_ALREADY_HANDLED },
      });
      expect(users.ensureStoreCustomer).not.toHaveBeenCalled();
      expect(orders.create).not.toHaveBeenCalled();
    });

    it('409 when another employee took it a moment earlier: no order is created', async () => {
      prisma.onlineOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.confirm(REQUEST, confirmDto(), seller),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(orders.create).not.toHaveBeenCalled();
      expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it('names the lines that are archived, not for sale or from another store', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValue(
        requestRow({
          items: [
            {
              variantId: V1,
              quantity: 2,
              variant: variantRow({ canSell: false }),
            },
            {
              variantId: V2,
              quantity: 1,
              variant: variantRow({
                product: { name: 'Zherd', isArchived: true },
                attributes: [],
              }),
            },
            {
              variantId: 'v3',
              quantity: 1,
              variant: variantRow({ storeId: OTHER_STORE }),
            },
          ],
        }),
      );

      await expect(
        service.confirm(REQUEST, confirmDto(), seller),
      ).rejects.toMatchObject({
        response: {
          code: ITEMS_UNAVAILABLE,
          lines: [
            { variantId: V1, label: 'Strapela 6' },
            { variantId: V2, label: 'Zherd' },
            { variantId: 'v3', label: 'Strapela 6' },
          ],
        },
      });
      expect(users.ensureStoreCustomer).not.toHaveBeenCalled();
      expect(orders.create).not.toHaveBeenCalled();
    });

    it('says what the warehouse is missing and creates nothing', async () => {
      prisma.inventory.findMany.mockResolvedValue([
        { warehouseId: W1, variantId: V1, quantity: 1 },
      ]);

      await expect(
        service.confirm(REQUEST, confirmDto(), seller),
      ).rejects.toMatchObject({
        response: {
          code: INSUFFICIENT_STOCK,
          lines: [
            { variantId: V1, label: 'Strapela 6', requested: 2, available: 1 },
            { variantId: V2, label: 'Zherd', requested: 1, available: 0 },
          ],
        },
      });
      expect(prisma.inventory.findMany.mock.calls[0][0].where.warehouseId).toBe(
        W1,
      );
      expect(users.ensureStoreCustomer).not.toHaveBeenCalled();
      expect(prisma.onlineOrder.updateMany).not.toHaveBeenCalled();
      expect(orders.create).not.toHaveBeenCalled();
    });

    it('if the lines are refused after the order was created: removes it, gives the request back, rethrows', async () => {
      const refused = new BadRequestException(
        'Insufficient stock for variant: variant-1',
      );
      orders.createOrderItems.mockRejectedValue(refused);

      await expect(service.confirm(REQUEST, confirmDto(), seller)).rejects.toBe(
        refused,
      );

      expect(prisma.orderItem.deleteMany).toHaveBeenCalledWith({
        where: { orderId: 'order-1' },
      });
      expect(prisma.order.delete).toHaveBeenCalledWith({
        where: { id: 'order-1' },
      });
      expect(prisma.onlineOrder.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: REQUEST,
          status: OnlineOrderStatus.CONFIRMED,
          orderId: null,
        },
        data: {
          status: OnlineOrderStatus.NEW,
          handledById: null,
          handledAt: null,
          customerId: null,
        },
      });
      expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it('if the order itself cannot be created: gives the request back, nothing to remove', async () => {
      orders.create.mockRejectedValue(
        new BadRequestException('Staff does not belong'),
      );

      await expect(
        service.confirm(REQUEST, confirmDto(), seller),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.order.delete).not.toHaveBeenCalled();
      expect(prisma.onlineOrder.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: OnlineOrderStatus.NEW,
          }) as unknown,
        }),
      );
    });

    it('still reports the original failure when the clean-up fails too', async () => {
      const refused = new BadRequestException('boom');
      orders.createOrderItems.mockRejectedValue(refused);
      prisma.$transaction.mockRejectedValue(new Error('db down'));
      prisma.onlineOrder.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockRejectedValueOnce(new Error('db down'));

      await expect(service.confirm(REQUEST, confirmDto(), seller)).rejects.toBe(
        refused,
      );
      expect(logger.error).toHaveBeenCalledTimes(2);
    });

    it('is confirmed even if the customer cannot be written to; the answer says so', async () => {
      client.sendMessage.mockRejectedValue(
        new Error('bot was blocked by the user'),
      );

      await expect(
        service.confirm(REQUEST, confirmDto(), seller),
      ).resolves.toMatchObject({
        orderId: 'order-1',
        customerNotified: false,
      });
    });

    it('customerNotified is false when the store has no bot any more', async () => {
      prisma.storeTelegramBot.findUnique.mockResolvedValue(null);

      await expect(
        service.confirm(REQUEST, confirmDto(), seller),
      ).resolves.toMatchObject({
        customerNotified: false,
      });
      expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it('an existing customer is reported as not created', async () => {
      users.ensureStoreCustomer.mockResolvedValue({
        customerId: 'cust-9',
        created: false,
      });

      await expect(
        service.confirm(REQUEST, confirmDto(), seller),
      ).resolves.toMatchObject({
        customerId: 'cust-9',
        customerCreated: false,
      });
    });
  });

  describe('reject', () => {
    it('marks it rejected with the trimmed reason and tells the customer', async () => {
      const result = await service.reject(
        REQUEST,
        rejectDto('  Нет в наличии  '),
        seller,
      );

      expect(prisma.onlineOrder.updateMany).toHaveBeenCalledWith({
        where: { id: REQUEST, storeId: STORE, status: OnlineOrderStatus.NEW },
        data: {
          status: OnlineOrderStatus.REJECTED,
          handledById: 'staff-1',
          handledAt: expect.any(Date) as unknown as Date,
          rejectReason: 'Нет в наличии',
        },
      });
      expect(result).toEqual({ customerNotified: true });
      const text = (client.sendMessage.mock.calls[0] as string[])[2];
      expect(text).toContain('Заявка №12 отклонена. Причина: Нет в наличии');
      expect(text).toContain('Sabab: Нет в наличии');
    });

    it('a blank or missing reason is stored as null and not mentioned', async () => {
      await service.reject(REQUEST, rejectDto('   '), seller);

      expect(
        prisma.onlineOrder.updateMany.mock.calls[0][0].data.rejectReason,
      ).toBeNull();
      expect((client.sendMessage.mock.calls[0] as string[])[2]).not.toContain(
        'Причина',
      );
    });

    it('404 for another store’s request, 409 when already handled or taken a moment earlier', async () => {
      prisma.onlineOrder.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.reject(REQUEST, rejectDto(), seller),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.onlineOrder.findFirst.mockResolvedValueOnce(
        requestRow({ status: OnlineOrderStatus.REJECTED }),
      );
      await expect(
        service.reject(REQUEST, rejectDto(), seller),
      ).rejects.toBeInstanceOf(ConflictException);

      prisma.onlineOrder.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.reject(REQUEST, rejectDto(), seller),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it('is rejected even if the customer cannot be written to', async () => {
      client.sendMessage.mockRejectedValue(new Error('chat not found'));

      await expect(
        service.reject(REQUEST, rejectDto(), seller),
      ).resolves.toEqual({
        customerNotified: false,
      });
    });
  });
});

describe('findShortages', () => {
  const lines = [
    { variantId: 'a', label: 'A', quantity: 2 },
    { variantId: 'b', label: 'B', quantity: 1 },
  ];

  it('lists only the lines the stock does not cover; a missing row is zero', () => {
    expect(findShortages(lines, new Map([['a', 5]]))).toEqual([
      { variantId: 'b', label: 'B', requested: 1, available: 0 },
    ]);
    expect(
      findShortages(
        lines,
        new Map([
          ['a', 1],
          ['b', 1],
        ]),
      ),
    ).toEqual([{ variantId: 'a', label: 'A', requested: 2, available: 1 }]);
  });

  it('is empty when everything is there', () => {
    expect(
      findShortages(
        lines,
        new Map([
          ['a', 2],
          ['b', 9],
        ]),
      ),
    ).toEqual([]);
  });
});
