import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { StaffRole, UserRole, UserType } from '@generated/enums';
import { Prisma } from '@generated/client';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { CategoryAttributesService } from './category-attributes.service';

const STORE = '11111111-1111-4111-8111-111111111111';
const DIRECTION = '22222222-2222-4222-8222-222222222222';
const SUB = '33333333-3333-4333-8333-333333333333';

function makeUser(role: UserRole, staffRole: StaffRole | null): CurrentUser {
  return {
    id: 'user',
    role,
    type: UserType.STAFF,
    staff: staffRole
      ? { id: 'staff', storeId: STORE, role: staffRole, warehouse: [] }
      : null,
  } as unknown as CurrentUser;
}

const owner = () => makeUser(UserRole.USER, StaffRole.OWNER);
const seller = () => makeUser(UserRole.USER, StaffRole.SELLER);
const admin = () => makeUser(UserRole.ADMIN, null);

const shoes = {
  id: SUB,
  name: 'Обувь',
  nameUz: 'Poyabzal',
  nameEn: 'Shoes',
  parentId: DIRECTION,
};

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('CategoryAttributesService — subcategories', () => {
  let service: CategoryAttributesService;
  const prisma = {
    category: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    categoriesOnStore: { findUnique: jest.fn() },
    product: { count: jest.fn() },
  };
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoryAttributesService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: getLoggerToken(CategoryAttributesService.name),
          useValue: logger,
        },
      ],
    }).compile();
    service = module.get(CategoryAttributesService);
  });

  describe('findOrCreateSubcategory', () => {
    beforeEach(() => {
      prisma.category.findUnique.mockResolvedValue({ parentId: null });
      prisma.categoriesOnStore.findUnique.mockResolvedValue({
        storeId: STORE,
        categoryId: DIRECTION,
      });
      prisma.category.findFirst.mockResolvedValue(null);
      prisma.category.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'new', nameUz: null, nameEn: null, ...data }),
      );
    });

    it('creates a trimmed subcategory under the owner store direction', async () => {
      const res = await service.findOrCreateSubcategory(
        { parentId: DIRECTION, name: '  Детская   обувь ' },
        owner(),
      );
      expect(prisma.categoriesOnStore.findUnique).toHaveBeenCalledWith({
        where: {
          storeId_categoryId: { storeId: STORE, categoryId: DIRECTION },
        },
      });
      expect(prisma.category.create.mock.calls[0][0].data).toEqual({
        name: 'Детская обувь',
        parentId: DIRECTION,
        createdById: 'user',
      });
      expect(res.name).toBe('Детская обувь');
    });

    it('returns the existing category, matching any language case-insensitively', async () => {
      prisma.category.findFirst.mockResolvedValue(shoes);
      const res = await service.findOrCreateSubcategory(
        { parentId: DIRECTION, name: 'poyabzal' },
        owner(),
      );
      expect(res).toBe(shoes);
      expect(prisma.category.create).not.toHaveBeenCalled();
      const where = prisma.category.findFirst.mock.calls[0][0].where;
      expect(where.parentId).toBe(DIRECTION);
      expect(where.OR).toEqual([
        { name: { equals: 'poyabzal', mode: 'insensitive' } },
        { nameUz: { equals: 'poyabzal', mode: 'insensitive' } },
        { nameEn: { equals: 'poyabzal', mode: 'insensitive' } },
      ]);
    });

    it('returns the row created concurrently when the insert hits the unique index', async () => {
      prisma.category.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(shoes);
      prisma.category.create.mockRejectedValue(uniqueViolation());
      const res = await service.findOrCreateSubcategory(
        { parentId: DIRECTION, name: 'Обувь' },
        owner(),
      );
      expect(res).toBe(shoes);
    });

    it('rejects a direction of another store with 403', async () => {
      prisma.categoriesOnStore.findUnique.mockResolvedValue(null);
      await expect(
        service.findOrCreateSubcategory(
          { parentId: DIRECTION, name: 'Обувь' },
          owner(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.category.create).not.toHaveBeenCalled();
    });

    it('lets an admin add under any direction', async () => {
      await service.findOrCreateSubcategory(
        { parentId: DIRECTION, name: 'Обувь' },
        admin(),
      );
      expect(prisma.categoriesOnStore.findUnique).not.toHaveBeenCalled();
      expect(prisma.category.create).toHaveBeenCalled();
    });

    it('rejects a seller with 403', async () => {
      await expect(
        service.findOrCreateSubcategory(
          { parentId: DIRECTION, name: 'Обувь' },
          seller(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.category.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a subcategory as parent with 400', async () => {
      prisma.category.findUnique.mockResolvedValue({ parentId: DIRECTION });
      await expect(
        service.findOrCreateSubcategory(
          { parentId: SUB, name: 'Кеды' },
          owner(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an unknown parent with 404', async () => {
      prisma.category.findUnique.mockResolvedValue(null);
      await expect(
        service.findOrCreateSubcategory(
          { parentId: DIRECTION, name: 'Обувь' },
          owner(),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a name shorter than 2 characters after trimming', async () => {
      await expect(
        service.findOrCreateSubcategory(
          { parentId: DIRECTION, name: '  я ' },
          owner(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('updateSubcategory', () => {
    beforeEach(() => {
      prisma.category.findUnique.mockResolvedValue(shoes);
      prisma.category.findFirst.mockResolvedValue(null);
      prisma.category.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...shoes, ...data }),
      );
    });

    it('renames and clears a translation with an empty string', async () => {
      await service.updateSubcategory(SUB, { name: 'Обувь ', nameEn: '' });
      expect(prisma.category.update.mock.calls[0][0].data).toEqual({
        name: 'Обувь',
        nameEn: null,
      });
      expect(prisma.category.findFirst.mock.calls[0][0].where.id).toEqual({
        not: SUB,
      });
    });

    it('rejects a name used by another category of the direction with 409', async () => {
      prisma.category.findFirst.mockResolvedValue({
        ...shoes,
        id: 'other',
        name: 'Платья',
      });
      await expect(
        service.updateSubcategory(SUB, { nameUz: "ko'ylaklar" }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('rejects a store direction with 400', async () => {
      prisma.category.findUnique.mockResolvedValue({
        ...shoes,
        parentId: null,
      });
      await expect(
        service.updateSubcategory(DIRECTION, { name: 'Одежда' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an empty body with 400', async () => {
      await expect(service.updateSubcategory(SUB, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('removeSubcategory', () => {
    beforeEach(() => {
      prisma.category.findUnique.mockResolvedValue(shoes);
    });

    it('deletes a subcategory without products', async () => {
      prisma.product.count.mockResolvedValue(0);
      await expect(service.removeSubcategory(SUB)).resolves.toEqual({
        id: SUB,
      });
      expect(prisma.category.delete).toHaveBeenCalledWith({
        where: { id: SUB },
      });
    });

    it('rejects a subcategory that has products with 400', async () => {
      prisma.product.count.mockResolvedValue(3);
      await expect(service.removeSubcategory(SUB)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.category.delete).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown id', async () => {
      prisma.category.findUnique.mockResolvedValue(null);
      await expect(service.removeSubcategory(SUB)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

describe('CategoryAttributesService — attribute values', () => {
  let service: CategoryAttributesService;
  const ATTR = '44444444-4444-4444-8444-444444444444';
  const prisma = {
    attribute: { findUnique: jest.fn() },
    attributeValue: { findFirst: jest.fn(), create: jest.fn() },
  };
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const attribute = (type: string, onStore = true) => ({
    id: ATTR,
    name: 'Размер',
    type,
    unit: null,
    store: onStore ? [{ storeId: STORE, attributeId: ATTR }] : [],
  });
  const row = (over: Record<string, unknown>) => ({
    id: 'value',
    attributeId: ATTR,
    valueString: null,
    valueNumber: null,
    valueBool: null,
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoryAttributesService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: getLoggerToken(CategoryAttributesService.name),
          useValue: logger,
        },
      ],
    }).compile();
    service = module.get(CategoryAttributesService);
    prisma.attributeValue.findFirst.mockResolvedValue(null);
    prisma.attributeValue.create.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve(row(args.data)),
    );
  });

  it('lets a store owner create a value of a store attribute; STRING «42» stays a string', async () => {
    prisma.attribute.findUnique.mockResolvedValue(attribute('STRING'));
    const res = await service.createAttributeValue(
      { attributeId: ATTR, value: '  42 ' },
      owner(),
    );
    expect(prisma.attributeValue.create.mock.calls[0][0].data).toEqual({
      attributeId: ATTR,
      valueString: '42',
    });
    expect(res).toMatchObject({
      value: '42',
      attributeName: '42',
      created: true,
    });
  });

  it('returns the existing value (case-insensitive) instead of a duplicate', async () => {
    prisma.attribute.findUnique.mockResolvedValue(attribute('STRING'));
    prisma.attributeValue.findFirst.mockResolvedValue(
      row({ id: 'xl', valueString: 'XL' }),
    );
    const res = await service.createAttributeValue(
      { attributeId: ATTR, value: 'xl' },
      owner(),
    );
    expect(prisma.attributeValue.create).not.toHaveBeenCalled();
    expect(res).toMatchObject({ id: 'xl', value: 'XL', created: false });
  });

  it('stores a NUMBER value as a number and rejects text', async () => {
    prisma.attribute.findUnique.mockResolvedValue(attribute('NUMBER'));
    await service.createAttributeValue(
      { attributeId: ATTR, value: '6,5' },
      owner(),
    );
    expect(prisma.attributeValue.create.mock.calls[0][0].data).toEqual({
      attributeId: ATTR,
      valueNumber: 6.5,
    });
    await expect(
      service.createAttributeValue(
        { attributeId: ATTR, value: 'шесть' },
        owner(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an owner when the attribute is not on their store', async () => {
    prisma.attribute.findUnique.mockResolvedValue(attribute('STRING', false));
    await expect(
      service.createAttributeValue({ attributeId: ATTR, value: 'M' }, owner()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets an admin add a value to any attribute', async () => {
    prisma.attribute.findUnique.mockResolvedValue(attribute('STRING', false));
    await expect(
      service.createAttributeValue({ attributeId: ATTR, value: 'M' }, admin()),
    ).resolves.toMatchObject({ value: 'M' });
  });

  it('rejects an empty value and an unknown attribute', async () => {
    await expect(
      service.createAttributeValue(
        { attributeId: ATTR, value: '   ' },
        owner(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    prisma.attribute.findUnique.mockResolvedValue(null);
    await expect(
      service.createAttributeValue({ attributeId: ATTR, value: 'M' }, owner()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
