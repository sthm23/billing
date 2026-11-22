import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  CreateAttributeDto,
  CreateAttributeValueDto,
} from './dto/create-category-attribute.dto';
import { PrismaService } from '@prisma/prisma.service';
import { AttributeType, StaffRole, UserRole } from '@generated/enums';
import { Prisma } from '@generated/client';
import { PaginationParams } from '@shared/dto/pagination-params.dto';
import type { CurrentUser } from '@auth/models/auth.model';
import { AttributeParams } from './dto/attribute-params.dto';
import {
  CATEGORY_NAME_MAX,
  CATEGORY_NAME_MIN,
  CreateSubcategoryDto,
  UpdateSubcategoryDto,
} from './dto/subcategory.dto';

/** Fields of a category returned to clients; the client picks the label by its language. */
export const CATEGORY_SELECT = {
  id: true,
  name: true,
  nameUz: true,
  nameEn: true,
  parentId: true,
} satisfies Prisma.CategorySelect;

export type CategoryRow = Prisma.CategoryGetPayload<{
  select: typeof CATEGORY_SELECT;
}>;

/** Max length of an attribute value («XL», «Чёрный», «11×25»). */
export const ATTRIBUTE_VALUE_MAX = 50;

/** Trim and collapse inner whitespace. */
function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function assertNameLength(name: string): void {
  if (name.length < CATEGORY_NAME_MIN || name.length > CATEGORY_NAME_MAX) {
    throw new BadRequestException(
      `Category name must be ${CATEGORY_NAME_MIN}–${CATEGORY_NAME_MAX} characters`,
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class CategoryAttributesService {
  constructor(
    private prisma: PrismaService,
    @InjectPinoLogger(CategoryAttributesService.name)
    private readonly logger: PinoLogger,
  ) {}

  async findBrands() {
    try {
      return this.prisma.brand.findMany();
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  async findStoreBrands(storeId: string) {
    try {
      const brands = await this.prisma.brandsOnStore.findMany({
        where: { storeId },
        include: { brand: true },
      });
      return brands.map((b) => b.brand);
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  async findTags() {
    try {
      return this.prisma.tag.findMany({
        include: {
          values: true,
        },
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  /** Directions (level 1) with their subcategories (level 2). */
  findCategories() {
    return this.prisma.category.findMany({
      where: {
        parentId: null,
      },
      orderBy: { name: 'asc' },
      include: {
        store: true,
        children: { select: CATEGORY_SELECT, orderBy: { name: 'asc' } },
      },
    });
  }

  /** The store's directions with their subcategories (two levels). */
  async findStoreCategories(storeId: string) {
    try {
      const categories = await this.prisma.categoriesOnStore.findMany({
        where: {
          storeId,
        },
        include: {
          category: {
            select: {
              ...CATEGORY_SELECT,
              children: { select: CATEGORY_SELECT, orderBy: { name: 'asc' } },
            },
          },
        },
      });
      return categories
        .map((c) => c.category)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  /**
   * Find or create a subcategory of a store direction. Staff OWNER (only under a direction of
   * their store) or platform ADMIN. Matching is case-insensitive against name / nameUz / nameEn,
   * so «обувь», «Poyabzal» and «Shoes» all return the existing «Обувь».
   */
  async findOrCreateSubcategory(
    dto: CreateSubcategoryDto,
    user: CurrentUser,
  ): Promise<CategoryRow> {
    const isAdmin = user.role === UserRole.ADMIN;
    const isOwner =
      !!user.staff &&
      (user.role === UserRole.OWNER || user.staff.role === StaffRole.OWNER);
    if (!isAdmin && !isOwner) {
      throw new ForbiddenException(
        'Only the store owner or an admin can add categories',
      );
    }

    const name = normalizeName(dto.name);
    assertNameLength(name);

    const parent = await this.prisma.category.findUnique({
      where: { id: dto.parentId },
      select: { parentId: true },
    });
    if (!parent) throw new NotFoundException('Category not found');
    if (parent.parentId !== null) {
      throw new BadRequestException(
        'Parent must be a store direction (top-level category)',
      );
    }
    if (!isAdmin) {
      const link = await this.prisma.categoriesOnStore.findUnique({
        where: {
          storeId_categoryId: {
            storeId: user.staff.storeId,
            categoryId: dto.parentId,
          },
        },
      });
      if (!link)
        throw new ForbiddenException(
          'This direction does not belong to your store',
        );
    }

    const existing = await this.findByAnyName(dto.parentId, [name]);
    if (existing) return existing;

    try {
      const created = await this.prisma.category.create({
        data: { name, parentId: dto.parentId, createdById: user.id },
        select: CATEGORY_SELECT,
      });
      this.logger.info(
        { categoryId: created.id, parentId: dto.parentId, userId: user.id },
        'Subcategory created',
      );
      return created;
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        // Created concurrently by someone else
        const again = await this.findByAnyName(dto.parentId, [name]);
        if (again) return again;
      }
      throw error;
    }
  }

  /** ADMIN: rename a subcategory / set its translations. An empty nameUz / nameEn clears it. */
  async updateSubcategory(
    id: string,
    dto: UpdateSubcategoryDto,
  ): Promise<CategoryRow> {
    const category = await this.findSubcategory(id);

    const data: {
      name?: string;
      nameUz?: string | null;
      nameEn?: string | null;
    } = {};
    if (dto.name !== undefined) {
      data.name = normalizeName(dto.name);
      assertNameLength(data.name);
    }
    for (const key of ['nameUz', 'nameEn'] as const) {
      const value = dto[key];
      if (value === undefined) continue;
      const normalized = normalizeName(value);
      if (normalized) assertNameLength(normalized);
      data[key] = normalized || null;
    }
    const names = Object.values(data).filter((v): v is string => !!v);
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    const clash = await this.findByAnyName(category.parentId, names, id);
    if (clash) {
      throw new ConflictException(
        `Category «${clash.name}» already uses this name`,
      );
    }
    try {
      return await this.prisma.category.update({
        where: { id },
        data,
        select: CATEGORY_SELECT,
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A category with this name already exists');
      }
      throw error;
    }
  }

  /** ADMIN: delete a subcategory that has no products. */
  async removeSubcategory(id: string): Promise<{ id: string }> {
    await this.findSubcategory(id);
    const products = await this.prisma.product.count({
      where: { categoryId: id },
    });
    if (products > 0) {
      throw new BadRequestException(
        `Category has ${products} product(s) — move them to another category first`,
      );
    }
    await this.prisma.category.delete({ where: { id } });
    this.logger.info({ categoryId: id }, 'Subcategory deleted');
    return { id };
  }

  /** Level-2 category or 404 / 400. */
  private async findSubcategory(
    id: string,
  ): Promise<CategoryRow & { parentId: string }> {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: CATEGORY_SELECT,
    });
    if (!category) throw new NotFoundException('Category not found');
    if (category.parentId === null) {
      throw new BadRequestException('Store directions cannot be changed here');
    }
    return { ...category, parentId: category.parentId };
  }

  /** A category under `parentId` whose name, nameUz or nameEn equals one of `names` (case-insensitive). */
  private findByAnyName(parentId: string, names: string[], excludeId?: string) {
    if (names.length === 0) return Promise.resolve(null);
    return this.prisma.category.findFirst({
      where: {
        parentId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: names.flatMap((value) =>
          (['name', 'nameUz', 'nameEn'] as const).map((field) => ({
            [field]: { equals: value, mode: 'insensitive' as const },
          })),
        ),
      },
      select: CATEGORY_SELECT,
    });
  }
  async findAttributes({ currentPage = 1, pageSize = 10 }: AttributeParams) {
    try {
      const skip = (currentPage - 1) * pageSize;
      const take = +pageSize;
      const data = await this.prisma.attribute.findMany({
        skip,
        take: +take,
      });
      const totalOrders = await this.prisma.attribute.count();
      return {
        currentPage,
        pageSize,
        total: totalOrders,
        data,
      };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  async findAttributeItem(attrId: string) {
    try {
      const attributes = await this.prisma.attribute.findUnique({
        where: {
          id: attrId,
        },
        include: {
          values: true,
        },
      });
      return Promise.resolve({
        ...attributes,
        values:
          attributes?.values.map((el) => ({
            id: el.id,
            attributeId: el.attributeId,
            value:
              el.valueString !== null
                ? el.valueString
                : el.valueBool !== null
                  ? Boolean(el.valueBool)
                  : el.valueNumber !== null
                    ? Number(el.valueNumber)
                    : null,
          })) ?? [],
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  async findStoreAttributes(storeId: string) {
    try {
      const attributes = await this.prisma.attributeOnStore.findMany({
        where: {
          storeId,
        },
        include: {
          attribute: true,
        },
      });
      return attributes.map((a) => a.attribute);
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  async getAttributeItems(ids: string[]) {
    try {
      const attributeItems = await this.prisma.attributeValue.findMany({
        where: {
          attributeId: {
            in: ids,
          },
        },
        include: {
          attribute: true,
        },
      });
      return attributeItems.map((el) => {
        const value =
          el.valueString !== null
            ? el.valueString
            : el.valueBool !== null
              ? Boolean(el.valueBool)
              : el.valueNumber !== null
                ? Number(el.valueNumber)
                : null;
        return {
          id: el.id,
          attributeId: el.attributeId,
          attributeName: el.attribute.name,
          value: value,
        };
      });
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  async createAttribute(dto: CreateAttributeDto) {
    try {
      const attribute = await this.prisma.attribute.create({
        data: {
          name: dto.name,
          type: dto.type,
        },
      });
      this.logger.info(
        { attributeId: attribute.id, name: dto.name },
        'Attribute created',
      );
      return attribute;
    } catch (error: any) {
      this.logger.error(
        { name: dto.name, err: error.message },
        'Failed to create attribute',
      );
      throw new BadRequestException(error.response || error.message);
    }
  }
  /**
   * Find or create a value of an attribute (store OWNER for an attribute of
   * their store, or ADMIN). The value is stored by the attribute type
   * (STRING «42» stays a string); the same value (case-insensitive) returns the
   * existing row. Response keeps `attributeName` (= value) for the web.
   */
  async createAttributeValue(dto: CreateAttributeValueDto, user: CurrentUser) {
    const raw = normalizeName(dto.value ?? '');
    if (!raw) throw new BadRequestException('Value is required');
    if (raw.length > ATTRIBUTE_VALUE_MAX) {
      throw new BadRequestException(
        `Value must be at most ${ATTRIBUTE_VALUE_MAX} characters`,
      );
    }
    const attribute = await this.prisma.attribute.findUnique({
      where: { id: dto.attributeId },
      include: { store: { where: { storeId: user.staff?.storeId ?? '' } } },
    });
    if (!attribute) throw new NotFoundException('Attribute not found');
    if (user.role !== UserRole.ADMIN && !attribute.store?.length) {
      throw new ForbiddenException('The attribute is not used by your store');
    }

    const number = Number(raw.replace(',', '.'));
    const isNumber = raw !== '' && Number.isFinite(number);
    const lower = raw.toLocaleLowerCase();
    const isBool = lower === 'true' || lower === 'false';
    let data: Prisma.AttributeValueUncheckedCreateInput;
    switch (attribute.type) {
      case AttributeType.NUMBER:
        if (!isNumber) throw new BadRequestException('Value must be a number');
        data = { attributeId: attribute.id, valueNumber: number };
        break;
      case AttributeType.BOOLEAN:
        if (!isBool)
          throw new BadRequestException('Value must be true or false');
        data = { attributeId: attribute.id, valueBool: lower === 'true' };
        break;
      default:
        data = { attributeId: attribute.id, valueString: raw };
    }

    try {
      // Also match legacy rows stored in another column («42» saved as a number)
      const existing = await this.prisma.attributeValue.findFirst({
        where: {
          attributeId: attribute.id,
          OR: [
            { valueString: { equals: raw, mode: 'insensitive' } },
            ...(isNumber ? [{ valueNumber: number }] : []),
            ...(isBool ? [{ valueBool: lower === 'true' }] : []),
          ],
        },
      });
      const result =
        existing ?? (await this.prisma.attributeValue.create({ data }));
      if (!existing) {
        this.logger.info(
          { attributeValueId: result.id, attributeId: attribute.id },
          'Attribute value created',
        );
      }
      const value =
        result.valueString ??
        (result.valueNumber !== null
          ? Number(result.valueNumber)
          : Boolean(result.valueBool));
      return {
        id: result.id,
        attributeId: result.attributeId,
        value,
        attributeName: value,
        created: !existing,
      };
    } catch (error: any) {
      this.logger.error(
        { attributeId: dto.attributeId, err: error.message },
        'Failed to create attribute value',
      );
      throw new BadRequestException(error.response || error.message);
    }
  }
}
