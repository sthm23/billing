import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { Prisma } from '@generated/client';
import { OnlineOrderStatus } from '@generated/enums';
import type { PrismaService } from '@prisma/prisma.service';
import {
  CreateOnlineOrderDto,
  OnlineOrderItemDto,
  ShopProductsQueryDto,
} from './dto/public-shop.dto';
import {
  attributeValueText,
  formatAmount,
  normalizePhone,
} from './public-shop.helpers';
import { PublicShopService } from './public-shop.service';
import type { ShopContext } from './shop-context';
import type { TelegramBotClient } from './telegram-bot.client';
import {
  ITEMS_UNAVAILABLE,
  PUBLIC_SHOP,
  TOO_MANY_PENDING_REQUESTS,
} from './telegram.constants';
import type { TokenCryptoService } from './token-crypto.service';

const STORE = 'store-1';
const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const D = (value: string | number) => new Prisma.Decimal(value);

const shop: ShopContext = {
  storeId: STORE,
  storeName: 'Baraka',
  slug: 'baraka_888',
  botTokenEnc: 'v1:enc',
  notifyChatId: '555',
  telegramUserId: '4242',
  languageCode: 'ru',
};

function orderDto(
  overrides: Partial<CreateOnlineOrderDto> = {},
): CreateOnlineOrderDto {
  return Object.assign(new CreateOnlineOrderDto(), {
    items: [
      Object.assign(new OnlineOrderItemDto(), { variantId: V1, quantity: 2 }),
    ],
    fullName: 'Ali Valiyev',
    phone: '+998901234567',
    region: 'samarkand',
    district: 'Urgut',
    ...overrides,
  });
}

const variantRow = (
  id: string,
  price: string,
  name = 'Strapela',
  value = '6',
) => ({
  id,
  price: D(price),
  product: { name },
  attributes: [
    { value: { valueString: null, valueNumber: D(value), valueBool: null } },
  ],
});

describe('PublicShopService', () => {
  let prisma: {
    product: {
      groupBy: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
    category: { findMany: jest.Mock };
    productVariant: { findMany: jest.Mock };
    onlineOrder: { count: jest.Mock; aggregate: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let client: { sendMessage: jest.Mock };
  let crypto: { decrypt: jest.Mock };
  let logger: { info: jest.Mock; warn: jest.Mock };
  let service: PublicShopService;

  beforeAll(() => {
    process.env.S3_PUBLIC_URL = 'https://s3.example/sthm-media';
  });

  beforeEach(() => {
    prisma = {
      product: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      category: { findMany: jest.fn().mockResolvedValue([]) },
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
      onlineOrder: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _max: { number: 11 } }),
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: { number: number } }) =>
            Promise.resolve({
              id: 'order-1',
              number: data.number,
              createdAt: new Date('2026-11-27T10:00:00Z'),
            }),
          ),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb(prisma),
    );
    client = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    crypto = { decrypt: jest.fn().mockReturnValue('123456789:TOKEN') };
    logger = { info: jest.fn(), warn: jest.fn() };
    service = new PublicShopService(
      prisma as unknown as PrismaService,
      client as unknown as TelegramBotClient,
      crypto as unknown as TokenCryptoService,
      logger as unknown as PinoLogger,
    );
  });

  describe('getShop', () => {
    it('returns the name, the categories with product counts and the regions', async () => {
      prisma.product.groupBy.mockResolvedValue([
        { categoryId: 'c2', _count: { _all: 3 } },
        { categoryId: 'c1', _count: { _all: 7 } },
      ]);
      prisma.category.findMany.mockResolvedValue([
        { id: 'c2', name: 'Жерди', nameUz: null, nameEn: null },
        { id: 'c1', name: 'Брус', nameUz: 'Brus', nameEn: null },
      ]);

      const info = await service.getShop(shop);

      expect(info.name).toBe('Baraka');
      expect(info.categories.map((c) => [c.name, c.count])).toEqual([
        ['Брус', 7],
        ['Жерди', 3],
      ]);
      expect(info.regions).toHaveLength(14);
      expect(prisma.product.groupBy.mock.calls[0][0].where).toMatchObject({
        storeId: STORE,
        isArchived: false,
        variants: { some: { canSell: true } },
      });
    });
  });

  describe('listProducts', () => {
    const row = (overrides: Record<string, unknown> = {}) => ({
      id: 'p1',
      name: 'Strapela',
      brand: { name: 'Acme' },
      category: { name: 'Брус', nameUz: null, nameEn: null },
      images: [{ key: 'products/store-1/a.jpg' }],
      variants: [
        { price: D('1200000'), inventory: [{ quantity: 3 }, { quantity: 4 }] },
        { price: D('900000'), inventory: [{ quantity: 0 }] },
      ],
      ...overrides,
    });

    it('shows only this store, not archived, with a sellable variant; newest first', async () => {
      await service.listProducts(shop, new ShopProductsQueryDto());

      const args = prisma.product.findMany.mock.calls[0][0];
      expect(args.where.AND[0]).toEqual({
        storeId: STORE,
        isArchived: false,
        variants: { some: { canSell: true } },
      });
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
      expect(args.select.variants.where).toEqual({ canSell: true });
      // stock of active warehouses only, all of them
      expect(args.select.variants.select.inventory.where).toEqual({
        warehouse: { isActive: true },
      });
    });

    it('maps price range, total stock over all warehouses and the main photo', async () => {
      prisma.product.count.mockResolvedValue(1);
      prisma.product.findMany.mockResolvedValue([row()]);

      const list = await service.listProducts(shop, new ShopProductsQueryDto());

      expect(list.data[0]).toEqual({
        id: 'p1',
        name: 'Strapela',
        brand: 'Acme',
        category: { name: 'Брус', nameUz: null, nameEn: null },
        imageUrl: 'https://s3.example/sthm-media/products/store-1/a.jpg',
        priceFrom: D('900000'),
        priceTo: D('1200000'),
        quantity: 7,
        inStock: true,
      });
    });

    it('a product with no stock is listed as out of stock, not hidden', async () => {
      prisma.product.findMany.mockResolvedValue([
        row({ variants: [{ price: D('500'), inventory: [] }], images: [] }),
      ]);

      const { data } = await service.listProducts(
        shop,
        new ShopProductsQueryDto(),
      );

      expect(data[0]).toMatchObject({
        quantity: 0,
        inStock: false,
        imageUrl: null,
      });
    });

    it('never exposes cost, SKU, barcode, warehouse or per-variant stock rows', async () => {
      prisma.product.findMany.mockResolvedValue([row()]);

      const { data } = await service.listProducts(
        shop,
        new ShopProductsQueryDto(),
      );
      const json = JSON.stringify(data);

      for (const secret of ['cost', 'sku', 'barCode', 'warehouse', 'storeId']) {
        expect(json).not.toContain(secret);
      }
    });

    it('searches by name and brand, and a direction includes its subcategories', async () => {
      await service.listProducts(
        shop,
        Object.assign(new ShopProductsQueryDto(), {
          search: '  брус ',
          categoryId: 'c1',
        }),
      );

      const and = prisma.product.findMany.mock.calls[0][0].where.AND;
      expect(and[1]).toEqual({
        OR: [
          { name: { contains: 'брус', mode: 'insensitive' } },
          { brand: { name: { contains: 'брус', mode: 'insensitive' } } },
        ],
      });
      expect(and[2]).toEqual({
        OR: [{ categoryId: 'c1' }, { category: { parentId: 'c1' } }],
      });
    });

    it('turns query strings into numbers and caps the page size', async () => {
      const query = Object.assign(new ShopProductsQueryDto(), {
        currentPage: '3' as unknown as number,
        pageSize: '500' as unknown as number,
      });

      const list = await service.listProducts(shop, query);

      expect(list).toMatchObject({
        currentPage: 3,
        pageSize: PUBLIC_SHOP.MAX_PAGE_SIZE,
      });
      expect(prisma.product.findMany.mock.calls[0][0]).toMatchObject({
        skip: 2 * PUBLIC_SHOP.MAX_PAGE_SIZE,
        take: PUBLIC_SHOP.MAX_PAGE_SIZE,
      });
    });

    it('falls back to page 1 and the default size for text, and never goes below 1', async () => {
      const text = Object.assign(new ShopProductsQueryDto(), {
        currentPage: 'abc' as unknown as number,
        pageSize: 'abc' as unknown as number,
      });
      const negative = Object.assign(new ShopProductsQueryDto(), {
        currentPage: '-4' as unknown as number,
        pageSize: '-5' as unknown as number,
      });

      await expect(service.listProducts(shop, text)).resolves.toMatchObject({
        currentPage: 1,
        pageSize: PUBLIC_SHOP.DEFAULT_PAGE_SIZE,
      });
      await expect(service.listProducts(shop, negative)).resolves.toMatchObject(
        {
          currentPage: 1,
          pageSize: 1,
        },
      );
    });
  });

  describe('getProduct', () => {
    const product = () => ({
      id: 'p1',
      name: 'Strapela',
      description: 'Сухая',
      brand: null,
      category: null,
      images: [
        { key: 'products/store-1/a.jpg' },
        { key: 'products/store-1/b.jpg' },
      ],
      variants: [
        {
          id: V1,
          price: D('1200000'),
          inventory: [{ quantity: 2 }],
          attributes: [
            {
              value: {
                attributeId: 'a1',
                valueString: null,
                valueNumber: D('6'),
                valueBool: null,
                attribute: {
                  name: 'Длина',
                  nameUz: 'Uzunlik',
                  nameEn: null,
                  unit: 'м',
                },
              },
            },
          ],
        },
      ],
    });

    it('looks the product up inside this store only', async () => {
      prisma.product.findFirst.mockResolvedValue(product());

      await service.getProduct(shop, 'p1');

      expect(prisma.product.findFirst.mock.calls[0][0].where).toEqual({
        id: 'p1',
        storeId: STORE,
        isArchived: false,
        variants: { some: { canSell: true } },
      });
    });

    it('404 for a product of another store, an archived one or one not for sale', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(service.getProduct(shop, 'p1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns photos, variants with price, stock and labelled attributes', async () => {
      prisma.product.findFirst.mockResolvedValue(product());

      const result = await service.getProduct(shop, 'p1');

      expect(result.images).toEqual([
        'https://s3.example/sthm-media/products/store-1/a.jpg',
        'https://s3.example/sthm-media/products/store-1/b.jpg',
      ]);
      expect(result.variants[0]).toEqual({
        id: V1,
        price: D('1200000'),
        quantity: 2,
        inStock: true,
        attributes: [
          {
            attributeId: 'a1',
            name: 'Длина',
            nameUz: 'Uzunlik',
            nameEn: null,
            unit: 'м',
            value: 6,
          },
        ],
      });
      expect(JSON.stringify(result)).not.toMatch(/cost|sku|barCode|warehouse/);
    });
  });

  describe('createOrder', () => {
    beforeEach(() => {
      prisma.productVariant.findMany.mockResolvedValue([
        variantRow(V1, '1200000'),
      ]);
    });

    it('saves a NEW request at the server price with the next number, and tells the store', async () => {
      const result = await service.createOrder(shop, orderDto());

      expect(prisma.onlineOrder.create).toHaveBeenCalledWith({
        data: {
          storeId: STORE,
          telegramUserId: '4242',
          fullName: 'Ali Valiyev',
          phone: '+998901234567',
          region: 'samarkand',
          district: 'Urgut',
          comment: null,
          number: 12,
          items: {
            create: [
              { variantId: V1, quantity: 2, priceAtRequest: D('1200000') },
            ],
          },
        },
        select: { id: true, number: true, createdAt: true },
      });
      expect(result).toEqual({
        id: 'order-1',
        number: 12,
        status: OnlineOrderStatus.NEW,
        total: '2400000',
        createdAt: new Date('2026-11-27T10:00:00Z'),
      });

      const [token, chat, text] = client.sendMessage.mock.calls[0] as [
        string,
        string,
        string,
      ];
      expect(token).toBe('123456789:TOKEN');
      expect(chat).toBe('555');
      expect(text).toContain('Новая заявка №12');
      expect(text).toContain('Ali Valiyev');
      expect(text).toContain('+998901234567');
      expect(text).toContain('Самаркандская область, Urgut');
      expect(text).toContain('Strapela 6 ×2 — 2 400 000');
      expect(text).toContain('Итого: 2 400 000 сум');
    });

    it('looks the variants up inside this store, for sale and not archived', async () => {
      await service.createOrder(shop, orderDto());

      expect(prisma.productVariant.findMany.mock.calls[0][0].where).toEqual({
        id: { in: [V1] },
        storeId: STORE,
        canSell: true,
        product: { isArchived: false },
      });
    });

    it('cleans the raw body itself: phone format, spaces, empty comment', async () => {
      await service.createOrder(
        shop,
        orderDto({
          phone: '90 123-45-67',
          fullName: '  Ali  ',
          district: ' Urgut ',
          comment: '   ',
        }),
      );

      expect(prisma.onlineOrder.create.mock.calls[0][0].data).toMatchObject({
        phone: '+998901234567',
        fullName: 'Ali',
        district: 'Urgut',
        comment: null,
      });
    });

    it('rejects a phone that is not an Uzbek mobile number, before touching the database', async () => {
      await expect(
        service.createOrder(shop, orderDto({ phone: '12345' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.onlineOrder.count).not.toHaveBeenCalled();
      expect(prisma.onlineOrder.create).not.toHaveBeenCalled();
    });

    it('rejects the same product twice', async () => {
      const twice = [
        Object.assign(new OnlineOrderItemDto(), { variantId: V1, quantity: 1 }),
        Object.assign(new OnlineOrderItemDto(), { variantId: V1, quantity: 3 }),
      ];

      await expect(
        service.createOrder(shop, orderDto({ items: twice })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.onlineOrder.create).not.toHaveBeenCalled();
    });

    it('refuses with 429 when the customer already has too many requests waiting', async () => {
      prisma.onlineOrder.count.mockResolvedValue(
        PUBLIC_SHOP.MAX_PENDING_PER_USER,
      );

      await expect(service.createOrder(shop, orderDto())).rejects.toMatchObject(
        {
          status: 429,
          response: { code: TOO_MANY_PENDING_REQUESTS },
        },
      );
      expect(prisma.onlineOrder.count.mock.calls[0][0].where).toEqual({
        storeId: STORE,
        telegramUserId: '4242',
        status: OnlineOrderStatus.NEW,
      });
      expect(prisma.onlineOrder.create).not.toHaveBeenCalled();
    });

    it('refuses lines that are not available here and names them', async () => {
      const two = [
        Object.assign(new OnlineOrderItemDto(), { variantId: V1, quantity: 1 }),
        Object.assign(new OnlineOrderItemDto(), { variantId: V2, quantity: 1 }),
      ];
      // V2 belongs to another store / is archived / not for sale: the query does not return it

      await expect(
        service.createOrder(shop, orderDto({ items: two })),
      ).rejects.toMatchObject({
        response: { code: ITEMS_UNAVAILABLE, variantIds: [V2] },
      });
      expect(prisma.onlineOrder.create).not.toHaveBeenCalled();
      expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it('takes a quantity sent as a string and never a price from the client', async () => {
      const line = Object.assign(new OnlineOrderItemDto(), {
        variantId: V1,
        quantity: '3' as unknown as number,
        price: '1',
      });

      const result = await service.createOrder(
        shop,
        orderDto({ items: [line] }),
      );

      expect(result.total).toBe('3600000');
      expect(
        prisma.onlineOrder.create.mock.calls[0][0].data.items.create[0],
      ).toEqual({
        variantId: V1,
        quantity: 3,
        priceAtRequest: D('1200000'),
      });
    });

    it('retries with the next number when a parallel request took it', async () => {
      const taken = new Prisma.PrismaClientKnownRequestError('Unique', {
        code: 'P2002',
        clientVersion: 'test',
      });
      prisma.onlineOrder.create.mockRejectedValueOnce(taken);
      prisma.onlineOrder.aggregate
        .mockResolvedValueOnce({ _max: { number: 11 } })
        .mockResolvedValueOnce({ _max: { number: 12 } });

      const result = await service.createOrder(shop, orderDto());

      expect(result.number).toBe(13);
      expect(prisma.onlineOrder.create).toHaveBeenCalledTimes(2);
    });

    it('gives up after a few lost races and passes other errors through', async () => {
      const taken = new Prisma.PrismaClientKnownRequestError('Unique', {
        code: 'P2002',
        clientVersion: 'test',
      });
      prisma.onlineOrder.create.mockRejectedValue(taken);

      await expect(service.createOrder(shop, orderDto())).rejects.toBe(taken);
      expect(prisma.onlineOrder.create).toHaveBeenCalledTimes(
        PUBLIC_SHOP.NUMBER_RETRIES,
      );

      prisma.onlineOrder.create
        .mockReset()
        .mockRejectedValue(new Error('db down'));
      await expect(service.createOrder(shop, orderDto())).rejects.toThrow(
        'db down',
      );
    });

    it('the request is saved even if the store cannot be told', async () => {
      client.sendMessage.mockRejectedValue(new Error('chat not found'));

      await expect(
        service.createOrder(shop, orderDto()),
      ).resolves.toMatchObject({ number: 12 });
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('does not even try to write when no notification chat is connected', async () => {
      await service.createOrder({ ...shop, notifyChatId: null }, orderDto());

      expect(client.sendMessage).not.toHaveBeenCalled();
      expect(prisma.onlineOrder.create).toHaveBeenCalled();
    });

    it('keeps the message short for a big request', async () => {
      const ids = Array.from(
        { length: 20 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      );
      prisma.productVariant.findMany.mockResolvedValue(
        ids.map((id, i) => variantRow(id, '1000', `Item ${i}`)),
      );
      const items = ids.map((variantId) =>
        Object.assign(new OnlineOrderItemDto(), { variantId, quantity: 1 }),
      );

      await service.createOrder(shop, orderDto({ items }));

      const text = (client.sendMessage.mock.calls[0] as string[])[2];
      expect(text.split('\n').filter((l) => l.startsWith('•'))).toHaveLength(
        PUBLIC_SHOP.MAX_MESSAGE_LINES,
      );
      expect(text).toContain('… и ещё 5');
      expect(text).toContain('Итого: 20 000 сум');
    });

    it('sends the customer text as plain text: no parse mode', async () => {
      await service.createOrder(
        shop,
        orderDto({ comment: '<b>hi</b> [x](http://evil)' }),
      );

      expect(client.sendMessage.mock.calls[0]).toHaveLength(3);
    });
  });
});

describe('public shop helpers', () => {
  it('normalizePhone accepts the usual spellings and refuses the rest', () => {
    expect(normalizePhone('+998901234567')).toBe('+998901234567');
    expect(normalizePhone('+998 90 123-45-67')).toBe('+998901234567');
    expect(normalizePhone('998901234567')).toBe('+998901234567');
    expect(normalizePhone('901234567')).toBe('+998901234567');
    expect(normalizePhone('+7 999 123 45 67')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('formatAmount groups thousands with spaces', () => {
    expect(formatAmount('2400000')).toBe('2 400 000');
    expect(formatAmount(999)).toBe('999');
    expect(formatAmount('1500.50')).toBe('1 500.50');
    expect(formatAmount('1500.00')).toBe('1 500');
  });

  it('attributeValueText reads a string, a number or a flag', () => {
    expect(
      attributeValueText({
        valueString: 'Красный',
        valueNumber: null,
        valueBool: null,
      }),
    ).toBe('Красный');
    expect(
      attributeValueText({
        valueString: null,
        valueNumber: D('6'),
        valueBool: null,
      }),
    ).toBe('6');
    expect(
      attributeValueText({
        valueString: null,
        valueNumber: null,
        valueBool: true,
      }),
    ).toBe('да');
    expect(
      attributeValueText({
        valueString: null,
        valueNumber: null,
        valueBool: null,
      }),
    ).toBe('');
  });
});
