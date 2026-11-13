import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { StaffRole, UserRole, UserType } from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import { BarcodeService } from '@shared/helper/bar-code.service';
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
    product: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    productVariant: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    warehouse: { findUnique: jest.fn(), findFirst: jest.fn() },
    inventory: { create: jest.fn() },
    variantAttributeValue: { createMany: jest.fn() },
    $transaction: jest.fn(),
    stockMovement: { count: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  };
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
                stockRow('empty', []),
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
        total: 3,
        counts: { all: 3, lowStock: 2 },
        lowStockThreshold: 5,
      });
    });

    it('returns only products with total stock ≤ 5 when lowStock is set', async () => {
      const res = await service.findAll({ lowStock: true }, makeUser());
      const where = prisma.product.findMany.mock.calls[1][0].where;
      expect(where.AND).toContainEqual({ id: { in: ['low', 'empty'] } });
      expect(res.total).toBe(2);
    });

    it('matches a category and its subcategories', async () => {
      await service.findAll({ categoryId: 'cat' }, makeUser());
      const where = prisma.product.findMany.mock.calls[1][0].where;
      expect(where.AND).toContainEqual({
        OR: [
          { categoryId: 'cat' },
          { category: { parentId: 'cat' } },
          { category: { parent: { parentId: 'cat' } } },
        ],
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
