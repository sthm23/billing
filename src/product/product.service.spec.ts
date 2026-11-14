import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { StaffRole, UserRole, UserType } from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import { BarcodeService } from '@shared/helper/bar-code.service';
import { S3Service } from '@prisma/s3.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { Prisma } from '@generated/client';
import {
  CreateProductVariantDto,
  ProductVariantDto,
} from './dto/create-product.dto';
import { ProductService } from './product.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const WAREHOUSE = '33333333-3333-4333-8333-333333333333';
const FOREIGN_WAREHOUSE = '99999999-9999-4999-8999-999999999999';

function makeUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: 'user',
    role: UserRole.USER,
    type: UserType.STAFF,
    staff: {
      id: 'staff',
      storeId: STORE,
      role: StaffRole.SELLER,
      warehouse: [{ warehouseId: WAREHOUSE }],
    },
    ...overrides,
  } as unknown as CurrentUser;
}

describe('ProductService', () => {
  let service: ProductService;
  const prisma = {
    product: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    category: { findFirst: jest.fn() },
    productVariant: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    attributeValue: { findMany: jest.fn() },
    warehouse: { findUnique: jest.fn(), findFirst: jest.fn() },
    inventory: { create: jest.fn() },
    variantAttributeValue: { createMany: jest.fn() },
    $transaction: jest.fn(),
    stockMovement: { count: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  };
  const s3 = { headObject: jest.fn() };
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.productVariant.count.mockResolvedValue(1);
    prisma.productVariant.findMany.mockResolvedValue([
      {
        id: 'variant',
        barCode: '2000000000017',
        price: 120000,
        sku: 'BEAM-6-11X25',
        product: { id: 'product', name: 'Половой брус 6м' },
        attributes: [
          {
            value: {
              attribute: { name: 'Размер' },
              valueString: '11×25',
              valueNumber: null,
              valueBool: null,
            },
          },
        ],
        inventory: [{ quantity: 34 }],
        stockMovements: [],
      },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: BarcodeService,
          useValue: {
            generateUniqueBarcode: jest.fn().mockResolvedValue('200000000001'),
          },
        },
        { provide: S3Service, useValue: s3 },
        { provide: getLoggerToken(ProductService.name), useValue: logger },
      ],
    }).compile();

    service = module.get<ProductService>(ProductService);
  });

  describe('findAll', () => {
    const stockRow = (id: string, quantities: number[]) => ({
      id,
      variants: quantities.map((quantity) => ({ inventory: [{ quantity }] })),
    });

    beforeEach(() => {
      prisma.product.findMany.mockImplementation(
        (args: { select?: unknown }) =>
          args.select
            ? Promise.resolve([
                stockRow('low', [2, 3]),
                stockRow('draft', []),
                stockRow('zero', [0]),
                stockRow('ok', [4, 9]),
              ])
            : Promise.resolve([]),
      );
    });

    it('scopes a seller to the store and their warehouses and counts low stock', async () => {
      const res = await service.findAll({ search: 'брус' }, makeUser());
      const where = prisma.product.findMany.mock.calls[1][0].where;
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { isArchived: false },
          { storeId: STORE },
          { warehouseId: { in: [WAREHOUSE] } },
        ]),
      );
      expect(JSON.stringify(where.AND)).toContain('брус');
      expect(res).toMatchObject({
        total: 4,
        counts: { all: 4, lowStock: 2 },
        lowStockThreshold: 5,
      });
    });

    it('returns only products with total stock ≤ 5 when lowStock is set', async () => {
      const res = await service.findAll({ lowStock: true }, makeUser());
      const where = prisma.product.findMany.mock.calls[1][0].where;
      // a draft (no variants) is not low stock; a variant with 0 left is
      expect(where.AND).toContainEqual({ id: { in: ['low', 'zero'] } });
      expect(res.total).toBe(2);
    });

    it('matches a category and its subcategories (two levels)', async () => {
      await service.findAll({ categoryId: 'cat' }, makeUser());
      const where = prisma.product.findMany.mock.calls[1][0].where;
      expect(where.AND).toContainEqual({
        OR: [{ categoryId: 'cat' }, { category: { parentId: 'cat' } }],
      });
    });

    it('lets an owner see every warehouse of the store', async () => {
      await service.findAll(
        {},
        makeUser({
          role: UserRole.OWNER,
          staff: {
            id: 'owner',
            storeId: STORE,
            role: StaffRole.OWNER,
            warehouse: [],
          },
        } as never),
      );
      const where = prisma.product.findMany.mock.calls[1][0].where;
      expect(where.AND).toContainEqual({ storeId: STORE });
      expect(JSON.stringify(where.AND)).not.toContain('warehouseId');
      expect(where.AND).not.toContainEqual({ variants: { some: {} } });
    });

    it('hides drafts (no variants) from a seller but not from a manager', async () => {
      await service.findAll({}, makeUser());
      expect(prisma.product.findMany.mock.calls[1][0].where.AND).toContainEqual(
        { variants: { some: {} } },
      );
      prisma.product.findMany.mockClear();
      await service.findAll(
        {},
        makeUser({
          staff: {
            id: 'm',
            storeId: STORE,
            role: StaffRole.MANAGER,
            warehouse: [{ warehouseId: WAREHOUSE }],
          },
        } as never),
      );
      expect(
        prisma.product.findMany.mock.calls[1][0].where.AND,
      ).not.toContainEqual({ variants: { some: {} } });
    });

    it('marks a product without variants as a draft', async () => {
      const row = {
        id: 'p',
        name: 'Рубашка',
        images: [],
        category: null,
        brand: null,
        warehouse: null,
        tags: [],
        variants: [],
      };
      prisma.product.findMany.mockImplementation((args: { select?: unknown }) =>
        Promise.resolve(args.select ? [stockRow('p', [])] : [row]),
      );
      const res = await service.findAll({}, makeUser({ role: UserRole.OWNER }));
      expect(res.data[0].isDraft).toBe(true);
    });
  });

  describe('findOne', () => {
    it('rejects a product of another store', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'product',
        storeId: 'foreign-store',
        warehouseId: WAREHOUSE,
      });
      await expect(
        service.findOne('product', makeUser()),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('findStockMovements', () => {
    it('returns movements of an accessible variant, newest first', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({
        storeId: STORE,
        warehouseId: WAREHOUSE,
      });
      prisma.stockMovement.count.mockResolvedValue(1);
      prisma.stockMovement.findMany.mockResolvedValue([
        {
          id: 'm1',
          type: 'OUT',
          reason: 'SALE',
          quantity: 2,
          unitCost: null,
          createdAt: new Date('2026-10-20'),
          createdBy: { user: { fullName: 'Алишер' } },
        },
      ]);
      const res = await service.findStockMovements(
        'variant',
        20,
        1,
        makeUser(),
      );
      expect(prisma.stockMovement.findMany.mock.calls[0][0]).toMatchObject({
        where: { variantId: 'variant' },
        orderBy: { createdAt: 'desc' },
      });
      expect(res).toMatchObject({
        total: 1,
        data: [{ id: 'm1', createdBy: 'Алишер' }],
      });
    });

    it('rejects a variant of a warehouse the seller does not work in', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({
        storeId: STORE,
        warehouseId: FOREIGN_WAREHOUSE,
      });
      await expect(
        service.findStockMovements('variant', 20, 1, makeUser()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.stockMovement.findMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('archives a product of the manager warehouse', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'product',
        storeId: STORE,
        warehouseId: WAREHOUSE,
      });
      await service.remove(
        'product',
        makeUser({
          staff: {
            id: 'm',
            storeId: STORE,
            role: StaffRole.MANAGER,
            warehouse: [{ warehouseId: WAREHOUSE }],
          },
        } as never),
      );
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'product' },
        data: { isArchived: true },
      });
    });

    it('rejects a product of another store', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'product',
        storeId: 'foreign-store',
        warehouseId: WAREHOUSE,
      });
      await expect(
        service.remove('product', makeUser()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('searches only the staff warehouse of the staff store and returns the product name', async () => {
      const res = await service.search(20, 1, 'брус', WAREHOUSE, makeUser());
      const where = prisma.productVariant.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        warehouseId: WAREHOUSE,
        storeId: STORE,
        product: { isArchived: false },
      });
      expect(prisma.productVariant.count.mock.calls[0][0].where).toBe(where);
      expect(res.data[0]).toMatchObject({
        productName: 'Половой брус 6м',
        attributes: [{ name: 'Размер', value: '11×25' }],
        quantity: 34,
      });
    });

    it('rejects a warehouse the staff has no access to', async () => {
      await expect(
        service.search(20, 1, 'брус', FOREIGN_WAREHOUSE, makeUser()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
    });

    it('lets an admin search any warehouse', async () => {
      await service.search(
        20,
        1,
        'брус',
        FOREIGN_WAREHOUSE,
        makeUser({ role: UserRole.ADMIN, staff: null } as never),
      );
      expect(
        prisma.productVariant.findMany.mock.calls[0][0].where,
      ).toMatchObject({ warehouseId: FOREIGN_WAREHOUSE });
      expect(
        prisma.productVariant.findMany.mock.calls[0][0].where.storeId,
      ).toBeUndefined();
    });
  });
  describe('variant sale/rent flags', () => {
    const owner = () =>
      makeUser({
        role: UserRole.OWNER,
        staff: {
          id: 'staff',
          storeId: STORE,
          role: StaffRole.OWNER,
          warehouse: [{ warehouseId: WAREHOUSE }],
        },
      } as unknown as Partial<CurrentUser>);
    const createDto = (variant: Partial<ProductVariantDto>) =>
      ({
        storeId: STORE,
        warehouseId: WAREHOUSE,
        productId: 'product',
        category: 'Dresses',
        variants: [
          {
            retailPrice: 0,
            costPrice: 0,
            quantity: 1,
            attributes: [],
            ...variant,
          },
        ],
      }) as CreateProductVariantDto;

    beforeEach(() => {
      prisma.$transaction.mockImplementation(
        (cb: (tx: typeof prisma) => unknown) => cb(prisma),
      );
      prisma.product.findUnique.mockResolvedValue({
        id: 'product',
        name: 'Dress',
        storeId: STORE,
        warehouseId: WAREHOUSE,
      });
      prisma.warehouse.findUnique.mockResolvedValue({
        id: WAREHOUSE,
        storeId: STORE,
      });
      prisma.productVariant.create.mockResolvedValue({ id: 'variant' });
      prisma.productVariant.findMany.mockResolvedValue([]);
      prisma.productVariant.findFirst.mockResolvedValue(null);
      prisma.attributeValue.findMany.mockResolvedValue([]);
    });

    it('builds the SKU from the category name in the DB, not the client string', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'product',
        name: 'Dress',
        storeId: STORE,
        warehouseId: WAREHOUSE,
        category: { name: 'Платья' },
      });
      await service.createProductVariant(
        { ...createDto({}), category: 'Hacked' },
        owner(),
      );
      const sku = prisma.productVariant.create.mock.calls[0][0].data.sku;
      expect(sku).toContain('ПЛАТЬЯ');
      expect(sku).not.toContain('HACKED');
    });

    it('creates a sellable, not rentable variant by default', async () => {
      await service.createProductVariant(createDto({}), owner());
      expect(prisma.productVariant.create.mock.calls[0][0].data).toMatchObject({
        canSell: true,
        canRent: false,
        rentPricePerDay: null,
      });
    });

    it('creates a rental-only variant with a rent price per day', async () => {
      await service.createProductVariant(
        createDto({ canSell: false, canRent: true, rentPricePerDay: 200000 }),
        owner(),
      );
      const data = prisma.productVariant.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ canSell: false, canRent: true });
      expect(Number(data.rentPricePerDay)).toBe(200000);
    });

    it('rejects a rentable variant without a rent price', async () => {
      await expect(
        service.createProductVariant(createDto({ canRent: true }), owner()),
      ).rejects.toThrow('rent price per day');
      await expect(
        service.createProductVariant(
          createDto({ canRent: true, rentPricePerDay: 0 }),
          owner(),
        ),
      ).rejects.toThrow('rent price per day');
      expect(prisma.productVariant.create).not.toHaveBeenCalled();
    });

    it('keeps the saved rent price when only canRent is updated', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({
        id: 'variant',
        storeId: STORE,
        warehouseId: WAREHOUSE,
        canSell: true,
        canRent: false,
        rentPricePerDay: new Prisma.Decimal(150000),
      });
      prisma.warehouse.findUnique.mockResolvedValue({ id: WAREHOUSE });
      await service.updateProductVariant(
        'variant',
        { price: 100000, canRent: true },
        owner(),
      );
      const data = prisma.productVariant.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ canSell: true, canRent: true });
      expect(Number(data.rentPricePerDay)).toBe(150000);
    });

    it('rejects enabling rent on a variant without a rent price', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({
        id: 'variant',
        storeId: STORE,
        warehouseId: WAREHOUSE,
        canSell: true,
        canRent: false,
        rentPricePerDay: null,
      });
      prisma.warehouse.findUnique.mockResolvedValue({ id: WAREHOUSE });
      await expect(
        service.updateProductVariant(
          'variant',
          { price: 100000, canRent: true },
          owner(),
        ),
      ).rejects.toThrow('rent price per day');
      expect(prisma.productVariant.update).not.toHaveBeenCalled();
    });
  });

  describe('creating variants (mobile product form)', () => {
    const SIZE = 'attr-size';
    const COLOR = 'attr-color';
    const owner = () =>
      makeUser({
        role: UserRole.OWNER,
        staff: {
          id: 'staff',
          storeId: STORE,
          role: StaffRole.OWNER,
          warehouse: [{ warehouseId: WAREHOUSE }],
        },
      } as unknown as Partial<CurrentUser>);
    const variant = (over: Partial<ProductVariantDto> = {}) =>
      ({
        retailPrice: 180000,
        costPrice: 120000,
        quantity: 10,
        attributes: [],
        ...over,
      }) as ProductVariantDto;
    const dto = (variants: ProductVariantDto[]) =>
      ({
        storeId: STORE,
        warehouseId: WAREHOUSE,
        productId: 'product',
        variants,
      }) as CreateProductVariantDto;
    const attrs = (...ids: string[]) =>
      ids.map((id) => ({ attributeValueId: id, value: 'client' }));
    const value = (id: string, attributeId: string, valueString: string) => ({
      id,
      attributeId,
      valueString,
      valueNumber: null,
      valueBool: null,
    });

    beforeEach(() => {
      prisma.$transaction.mockImplementation(
        (cb: (tx: typeof prisma) => unknown) => cb(prisma),
      );
      prisma.product.findUnique.mockResolvedValue({
        id: 'product',
        name: 'Oxford',
        storeId: STORE,
        warehouseId: WAREHOUSE,
        category: { name: 'Рубашки' },
        attributes: [{ attributeId: SIZE }, { attributeId: COLOR }],
      });
      prisma.warehouse.findUnique.mockResolvedValue({
        id: WAREHOUSE,
        storeId: STORE,
      });
      prisma.productVariant.create.mockResolvedValue({ id: 'variant' });
      prisma.productVariant.findMany.mockResolvedValue([]);
      prisma.productVariant.findFirst.mockResolvedValue(null);
      prisma.attributeValue.findMany.mockResolvedValue([
        value('m', SIZE, 'M'),
        value('l', SIZE, 'L'),
        value('white', COLOR, 'Белый'),
        value('len', 'attr-length', '6'),
      ]);
    });

    it('creates a qty-0 variant (future goods) without a stock movement', async () => {
      await service.createProductVariant(
        dto([variant({ quantity: 0, attributes: attrs('m', 'white') })]),
        owner(),
      );
      expect(prisma.inventory.create.mock.calls[0][0].data.quantity).toBe(0);
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });

    it('records a purchase movement with the cost when qty > 0', async () => {
      await service.createProductVariant(
        dto([variant({ quantity: 3, attributes: attrs('m', 'white') })]),
        owner(),
      );
      const data = prisma.stockMovement.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ quantity: 3, createdById: 'staff' });
      expect(Number(data.unitCost)).toBe(120000);
    });

    it('builds the SKU from DB values, not the client value strings', async () => {
      await service.createProductVariant(
        dto([variant({ attributes: attrs('m', 'white') })]),
        owner(),
      );
      const sku = prisma.productVariant.create.mock.calls[0][0].data.sku;
      expect(sku).toContain('M');
      expect(sku).not.toContain('CLIENT');
    });

    it('rejects a value of an attribute the product does not have', async () => {
      await expect(
        service.createProductVariant(
          dto([variant({ attributes: attrs('m', 'len') })]),
          owner(),
        ),
      ).rejects.toThrow('does not belong');
      expect(prisma.productVariant.create).not.toHaveBeenCalled();
    });

    it('rejects two values of one attribute in a variant', async () => {
      await expect(
        service.createProductVariant(
          dto([variant({ attributes: attrs('m', 'l') })]),
          owner(),
        ),
      ).rejects.toThrow('one value per attribute');
    });

    it('rejects duplicate combinations in the request and against existing variants', async () => {
      await expect(
        service.createProductVariant(
          dto([
            variant({ attributes: attrs('m', 'white') }),
            variant({ attributes: attrs('white', 'm') }),
          ]),
          owner(),
        ),
      ).rejects.toThrow('same attribute values');
      prisma.productVariant.findMany.mockResolvedValue([
        {
          attributes: [
            { attributeValueId: 'white' },
            { attributeValueId: 'm' },
          ],
        },
      ]);
      await expect(
        service.createProductVariant(
          dto([variant({ attributes: attrs('m', 'white') })]),
          owner(),
        ),
      ).rejects.toThrow('same attribute values');
      expect(prisma.productVariant.create).not.toHaveBeenCalled();
    });

    it('uses a free manual barcode and generates one for an empty field', async () => {
      await service.createProductVariant(
        dto([
          variant({
            attributes: attrs('m', 'white'),
            barCode: '4780012345671',
          }),
          variant({ attributes: attrs('l', 'white'), barCode: '' }),
        ]),
        owner(),
      );
      expect(prisma.productVariant.findFirst.mock.calls[0][0].where).toEqual({
        storeId: STORE,
        barCode: { in: ['4780012345671'] },
      });
      const codes = prisma.productVariant.create.mock.calls.map(
        (c: [{ data: { barCode: string } }]) => c[0].data.barCode,
      );
      expect(codes).toEqual(['4780012345671', '200000000001']);
    });

    it('rejects a barcode taken in the store with 409', async () => {
      prisma.productVariant.findFirst.mockResolvedValueOnce({
        barCode: '4780012345671',
      });
      await expect(
        service.createProductVariant(
          dto([variant({ attributes: attrs('m'), barCode: '4780012345671' })]),
          owner(),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.productVariant.create).not.toHaveBeenCalled();
    });

    it('rejects the same barcode on two variants', async () => {
      await expect(
        service.createProductVariant(
          dto([
            variant({ attributes: attrs('m'), barCode: '4780012345671' }),
            variant({ attributes: attrs('l'), barCode: '4780012345671' }),
          ]),
          owner(),
        ),
      ).rejects.toThrow('two variants');
    });

    it('skips a generated code that is already taken in the store', async () => {
      prisma.productVariant.findFirst
        .mockResolvedValueOnce({ id: 'manual' })
        .mockResolvedValueOnce(null);
      await service.createProductVariant(
        dto([variant({ attributes: attrs('m') })]),
        owner(),
      );
      expect(prisma.productVariant.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe('store checks on create / update', () => {
    const FOREIGN_STORE = '22222222-2222-4222-8222-222222222222';
    const owner = () =>
      makeUser({
        role: UserRole.OWNER,
        staff: {
          id: 'staff',
          storeId: STORE,
          role: StaffRole.OWNER,
          warehouse: [{ warehouseId: WAREHOUSE }],
        },
      } as unknown as Partial<CurrentUser>);
    const manager = () =>
      makeUser({
        staff: {
          id: 'staff',
          storeId: STORE,
          role: StaffRole.MANAGER,
          warehouse: [{ warehouseId: WAREHOUSE }],
        },
      } as unknown as Partial<CurrentUser>);

    it('rejects creating a product in a warehouse of another store', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(null);
      await expect(
        service.createProduct(
          { warehouseId: FOREIGN_WAREHOUSE } as never,
          owner(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.warehouse.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: FOREIGN_WAREHOUSE, storeId: STORE },
        }),
      );
      expect(prisma.warehouse.findUnique).not.toHaveBeenCalled();
    });

    describe('category of a new product', () => {
      const dto = {
        warehouseId: WAREHOUSE,
        categoryId: 'sub',
        brandId: 'brand',
        name: 'Брус 50×50',
        images: [],
        attributeIds: [],
        tagIds: [],
      } as never;

      beforeEach(() => {
        prisma.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
        prisma.warehouse.findUnique.mockResolvedValue({
          id: WAREHOUSE,
          storeId: STORE,
        });
        prisma.product.create.mockResolvedValue({ id: 'product' });
      });

      it('requires a subcategory of one of the store directions', async () => {
        prisma.category.findFirst.mockResolvedValue({ id: 'sub' });
        await service.createProduct(dto, owner());
        expect(prisma.category.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: 'sub',
              parent: { parentId: null, store: { some: { storeId: STORE } } },
            },
          }),
        );
        expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({
          categoryId: 'sub',
          storeId: STORE,
        });
      });

      it('rejects a direction, a foreign direction subcategory or an unknown id with 400', async () => {
        prisma.category.findFirst.mockResolvedValue(null);
        await expect(
          service.createProduct(dto, owner()),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.product.create).not.toHaveBeenCalled();
      });
    });

    describe('images of a new product', () => {
      const KEY = `products/${STORE}/1-2.webp`;
      const make = (images: string[]) =>
        ({
          warehouseId: WAREHOUSE,
          categoryId: 'sub',
          name: 'Брус 50×50',
          images,
          attributeIds: [],
          tagIds: [],
        }) as never;

      beforeEach(() => {
        process.env.S3_PUBLIC_URL = 'https://s3.example.uz/sthm-media/';
        prisma.warehouse.findFirst.mockResolvedValue({ id: WAREHOUSE });
        prisma.warehouse.findUnique.mockResolvedValue({
          id: WAREHOUSE,
          storeId: STORE,
        });
        prisma.category.findFirst.mockResolvedValue({ id: 'sub' });
        prisma.product.create.mockResolvedValue({ id: 'product' });
        s3.headObject.mockResolvedValue({
          size: 1000,
          contentType: 'image/webp',
        });
      });

      it('stores keys; a full public URL (legacy web) is turned into a key', async () => {
        await service.createProduct(
          make([
            KEY,
            `https://s3.example.uz/sthm-media/products/${STORE}/3-4.jpg?X-Amz-Signature=x`,
          ]),
          owner(),
        );
        expect(
          prisma.product.create.mock.calls[0][0].data.images.createMany.data,
        ).toEqual([
          { key: KEY, order: 0, isMain: true },
          { key: `products/${STORE}/3-4.jpg`, order: 1, isMain: false },
        ]);
      });

      it.each([
        ['another store prefix', `products/${FOREIGN_STORE}/1-2.webp`],
        [
          'a foreign host',
          `https://evil.example.com/products/${STORE}/1-2.webp`,
        ],
        ['a path outside products', `${STORE}/product/img/1-2.webp`],
        ['a traversal', `products/${STORE}/../${FOREIGN_STORE}/1.webp`],
      ])('rejects %s with 400', async (_name, value) => {
        await expect(
          service.createProduct(make([value]), owner()),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.product.create).not.toHaveBeenCalled();
      });

      it('rejects more than 5 images and duplicates', async () => {
        const six = Array.from(
          { length: 6 },
          (_, i) => `products/${STORE}/${i}.webp`,
        );
        await expect(
          service.createProduct(make(six), owner()),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          service.createProduct(make([KEY, KEY]), owner()),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(s3.headObject).not.toHaveBeenCalled();
      });

      it.each([
        ['not uploaded', null],
        [
          'larger than 5 MB',
          { size: 5 * 1024 * 1024 + 1, contentType: 'image/webp' },
        ],
        ['not an image', { size: 10, contentType: 'text/html' }],
      ])('rejects a file that is %s', async (_name, head) => {
        s3.headObject.mockResolvedValue(head);
        await expect(
          service.createProduct(make([KEY]), owner()),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(s3.headObject).toHaveBeenCalledWith(KEY);
        expect(prisma.product.create).not.toHaveBeenCalled();
      });
    });

    it('rejects creating a product in a warehouse the manager does not work in', async () => {
      await expect(
        service.createProduct(
          { warehouseId: FOREIGN_WAREHOUSE } as never,
          manager(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects adding variants to a product of another store', async () => {
      prisma.product.findUnique.mockResolvedValue({
        id: 'product',
        name: 'Dress',
        storeId: FOREIGN_STORE,
        warehouseId: FOREIGN_WAREHOUSE,
      });
      await expect(
        service.createProductVariant(
          { productId: 'product', variants: [] } as never,
          owner(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects updating a variant of another store', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({
        id: 'variant',
        storeId: FOREIGN_STORE,
        warehouseId: FOREIGN_WAREHOUSE,
      });
      await expect(
        service.updateProductVariant('variant', { price: 1 }, owner()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.productVariant.update).not.toHaveBeenCalled();
    });

    it('rejects a staff OWNER (User.role USER) updating a variant of another store', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({
        id: 'variant',
        storeId: FOREIGN_STORE,
        warehouseId: FOREIGN_WAREHOUSE,
      });
      const staffOwner = makeUser({
        staff: {
          id: 'staff',
          storeId: STORE,
          role: StaffRole.OWNER,
          warehouse: [],
        },
      } as unknown as Partial<CurrentUser>);
      await expect(
        service.updateProductVariant('variant', { price: 1 }, staffOwner),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a manager updating a variant of a warehouse they do not work in', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({
        id: 'variant',
        storeId: STORE,
        warehouseId: FOREIGN_WAREHOUSE,
      });
      await expect(
        service.updateProductVariant('variant', { price: 1 }, manager()),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
