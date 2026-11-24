import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { AttributeType, UserRole, UserType } from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import {
  ATTRIBUTE_EXISTS_CODE,
  AdminCatalogService,
  CATALOG_IN_USE_CODE,
} from './admin-catalog.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const BRAND = '33333333-3333-4333-8333-333333333333';
const ATTR = '55555555-5555-4555-8555-555555555555';

const admin = {
  id: 'admin-user',
  role: UserRole.ADMIN,
  type: UserType.STAFF,
  staff: null,
} as unknown as CurrentUser;

const LENGTH = {
  id: ATTR,
  name: 'Длина',
  nameUz: 'Uzunlik',
  nameEn: 'Length',
  type: AttributeType.NUMBER,
  unit: 'м',
};

/** The thrown exception's response body */
async function errorBody(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    return (e as ConflictException).getResponse();
  }
  throw new Error('expected a rejection');
}

describe('AdminCatalogService', () => {
  let service: AdminCatalogService;
  const prisma = {
    store: { findUnique: jest.fn() },
    brand: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    attribute: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    product: { count: jest.fn() },
    brandsOnStore: {
      createMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    attributeOnStore: {
      createMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.store.findUnique.mockResolvedValue({ id: STORE });
    prisma.product.count.mockResolvedValue(0);
    prisma.$transaction.mockImplementation(
      (cb: (tx: typeof prisma) => unknown) => cb(prisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminCatalogService,
        { provide: PrismaService, useValue: prisma },
        { provide: getLoggerToken(AdminCatalogService.name), useValue: logger },
      ],
    }).compile();

    service = module.get(AdminCatalogService);
  });

  describe('searchBrands', () => {
    it('most connected first, storeCount from the store links', async () => {
      prisma.brand.findMany.mockResolvedValue([
        { id: BRAND, name: 'Knauf', _count: { stores: 31 } },
      ]);
      prisma.brand.count.mockResolvedValue(214);

      const result = await service.searchBrands({ search: 'kna' });

      expect(result).toEqual({
        data: [{ id: BRAND, name: 'Knauf', storeCount: 31 }],
        total: 214,
      });
      const args = prisma.brand.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        name: { contains: 'kna', mode: 'insensitive' },
      });
      expect(args.orderBy).toEqual([
        { stores: { _count: 'desc' } },
        { name: 'asc' },
      ]);
    });
  });

  describe('searchAttributes', () => {
    it('searches the Russian name and the translations', async () => {
      prisma.attribute.findMany.mockResolvedValue([
        { ...LENGTH, _count: { store: 14 } },
      ]);
      prisma.attribute.count.mockResolvedValue(1);

      const result = await service.searchAttributes({ search: 'uzun' });

      expect(result.data).toEqual([{ ...LENGTH, storeCount: 14 }]);
      expect(prisma.attribute.findMany.mock.calls[0][0].where).toEqual({
        OR: [
          { name: { contains: 'uzun', mode: 'insensitive' } },
          { nameUz: { contains: 'uzun', mode: 'insensitive' } },
          { nameEn: { contains: 'uzun', mode: 'insensitive' } },
        ],
      });
    });
  });

  describe('usage', () => {
    it('counts store products incl. archived; attribute on the card or in variant values', async () => {
      prisma.product.count.mockResolvedValueOnce(12).mockResolvedValueOnce(24);

      const usage = await service.usage(STORE, [BRAND], [ATTR]);

      expect(usage.brands.get(BRAND)).toBe(12);
      expect(usage.attributes.get(ATTR)).toBe(24);
      const [brandWhere, attrWhere] = prisma.product.count.mock.calls.map(
        (c: [{ where: unknown }]) => c[0].where,
      );
      // No isArchived filter: an archived product can be restored
      expect(brandWhere).toEqual({ storeId: STORE, brandId: BRAND });
      expect(attrWhere).toEqual({
        storeId: STORE,
        OR: [
          { attributes: { some: { attributeId: ATTR } } },
          {
            variants: {
              some: { attributes: { some: { value: { attributeId: ATTR } } } },
            },
          },
        ],
      });
    });
  });

  describe('connectBrand', () => {
    it('by name: reuses an existing brand (any case) and links it', async () => {
      prisma.brand.findFirst.mockResolvedValue({ id: BRAND, name: 'Knauf' });
      prisma.product.count.mockResolvedValue(3);

      const result = await service.connectBrand(
        STORE,
        { name: 'knauf' },
        admin,
      );

      expect(prisma.brand.create).not.toHaveBeenCalled();
      expect(prisma.brandsOnStore.createMany).toHaveBeenCalledWith({
        data: [{ storeId: STORE, brandId: BRAND }],
        skipDuplicates: true,
      });
      expect(result).toEqual({ id: BRAND, name: 'Knauf', productCount: 3 });
    });

    it('by name: creates a new brand', async () => {
      prisma.brand.findFirst.mockResolvedValue(null);
      prisma.brand.create.mockResolvedValue({ id: BRAND, name: 'Lider Mebel' });

      const result = await service.connectBrand(
        STORE,
        { name: 'Lider Mebel' },
        admin,
      );

      expect(prisma.brand.create).toHaveBeenCalledWith({
        data: { name: 'Lider Mebel' },
        select: { id: true, name: true },
      });
      expect(result.productCount).toBe(0);
    });

    it('by id: unknown brand → 404', async () => {
      prisma.brand.findUnique.mockResolvedValue(null);

      await expect(
        service.connectBrand(STORE, { brandId: BRAND }, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.brandsOnStore.createMany).not.toHaveBeenCalled();
    });

    it('unknown store → 404', async () => {
      prisma.store.findUnique.mockResolvedValue(null);

      await expect(
        service.connectBrand(STORE, { name: 'Knauf' }, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('connectAttribute', () => {
    it('by id: links an existing attribute', async () => {
      prisma.attribute.findUnique.mockResolvedValue(LENGTH);

      const result = await service.connectAttribute(
        STORE,
        { attributeId: ATTR },
        admin,
      );

      expect(prisma.attributeOnStore.createMany).toHaveBeenCalledWith({
        data: [{ storeId: STORE, attributeId: ATTR }],
        skipDuplicates: true,
      });
      expect(result).toEqual({ ...LENGTH, productCount: 0 });
    });

    it('new: creates it with translations; unit only for NUMBER', async () => {
      prisma.attribute.findFirst.mockResolvedValue(null);
      prisma.attribute.create.mockResolvedValue({
        ...LENGTH,
        id: 'new-attr',
        name: 'Влагостойкий',
        type: AttributeType.BOOLEAN,
        unit: null,
      });

      await service.connectAttribute(
        STORE,
        {
          newAttribute: {
            name: 'Влагостойкий',
            nameUz: 'Namga chidamli',
            type: AttributeType.BOOLEAN,
            unit: 'м',
          },
        },
        admin,
      );

      expect(prisma.attribute.create.mock.calls[0][0].data).toEqual({
        name: 'Влагостойкий',
        nameUz: 'Namga chidamli',
        nameEn: null,
        type: AttributeType.BOOLEAN,
        unit: null,
      });
      expect(prisma.attributeOnStore.createMany).toHaveBeenCalledWith({
        data: [{ storeId: STORE, attributeId: 'new-attr' }],
        skipDuplicates: true,
      });
    });

    it('new with a name already in the dictionary → 409 ATTRIBUTE_EXISTS with that attribute', async () => {
      prisma.attribute.findFirst.mockResolvedValue(LENGTH);

      const body = await errorBody(
        service.connectAttribute(
          STORE,
          { newAttribute: { name: 'length', type: AttributeType.STRING } },
          admin,
        ),
      );

      expect(body).toMatchObject({
        code: ATTRIBUTE_EXISTS_CODE,
        attribute: LENGTH,
      });
      expect(prisma.attribute.create).not.toHaveBeenCalled();
      expect(prisma.attributeOnStore.createMany).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('brand not used → link deleted', async () => {
      prisma.brandsOnStore.findUnique.mockResolvedValue({
        storeId: STORE,
        brandId: BRAND,
      });

      await service.disconnectBrand(STORE, BRAND, admin);

      expect(prisma.brandsOnStore.delete).toHaveBeenCalledWith({
        where: { storeId_brandId: { storeId: STORE, brandId: BRAND } },
      });
    });

    it('brand used in products (archived too) → 409 IN_USE with the count', async () => {
      prisma.brandsOnStore.findUnique.mockResolvedValue({
        storeId: STORE,
        brandId: BRAND,
      });
      prisma.product.count.mockResolvedValue(12);

      const body = await errorBody(
        service.disconnectBrand(STORE, BRAND, admin),
      );

      expect(body).toMatchObject({ code: CATALOG_IN_USE_CODE, count: 12 });
      expect(prisma.brandsOnStore.delete).not.toHaveBeenCalled();
    });

    it('brand not connected → 404', async () => {
      prisma.brandsOnStore.findUnique.mockResolvedValue(null);

      await expect(
        service.disconnectBrand(STORE, BRAND, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('attribute used in products → 409 IN_USE', async () => {
      prisma.attributeOnStore.findUnique.mockResolvedValue({
        storeId: STORE,
        attributeId: ATTR,
      });
      prisma.product.count.mockResolvedValue(24);

      const body = await errorBody(
        service.disconnectAttribute(STORE, ATTR, admin),
      );

      expect(body).toMatchObject({ code: CATALOG_IN_USE_CODE, count: 24 });
      expect(prisma.attributeOnStore.delete).not.toHaveBeenCalled();
    });

    it('attribute not used → link deleted', async () => {
      prisma.attributeOnStore.findUnique.mockResolvedValue({
        storeId: STORE,
        attributeId: ATTR,
      });

      await service.disconnectAttribute(STORE, ATTR, admin);

      expect(prisma.attributeOnStore.delete).toHaveBeenCalledWith({
        where: { storeId_attributeId: { storeId: STORE, attributeId: ATTR } },
      });
    });
  });
});
