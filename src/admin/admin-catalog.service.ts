import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@generated/client';
import { AttributeType } from '@generated/enums';
import { PrismaService } from '@prisma/prisma.service';
import type { CurrentUser } from '@auth/models/auth.model';
import { ATTRIBUTE_LABEL_SELECT } from '@shared/helper/attribute.helper';
import {
  CATALOG_PAGE_SIZE,
  CatalogSearchParams,
  ConnectStoreAttributeDto,
  ConnectStoreBrandDto,
} from './dto/admin-catalog.dto';

/** 409 on disconnect: the brand / attribute is used in the store's products */
export const CATALOG_IN_USE_CODE = 'IN_USE';
/** 409 on «new attribute»: one with this name already exists in the dictionary */
export const ATTRIBUTE_EXISTS_CODE = 'ATTRIBUTE_EXISTS';

const ATTRIBUTE_SELECT = {
  id: true,
  ...ATTRIBUTE_LABEL_SELECT,
  type: true,
  unit: true,
} satisfies Prisma.AttributeSelect;

type AttributeRow = Prisma.AttributeGetPayload<{
  select: typeof ATTRIBUTE_SELECT;
}>;

export type CatalogBrand = { id: string; name: string; storeCount: number };
export type CatalogAttribute = AttributeRow & { storeCount: number };
export type CatalogList<T> = { data: T[]; total: number };

/** A brand / attribute connected to a store, with the number of its products using it */
export type StoreBrand = { id: string; name: string; productCount: number };
export type StoreAttribute = AttributeRow & { productCount: number };

type Db = Prisma.TransactionClient | PrismaService;

/** Brands are global: an existing name (any case) is reused, otherwise created */
export async function findOrCreateBrand(
  db: Db,
  name: string,
): Promise<{ id: string; name: string }> {
  const existing = await db.brand.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true, name: true },
  });

  return (
    existing ??
    db.brand.create({ data: { name }, select: { id: true, name: true } })
  );
}

/** An attribute whose Russian name or a translation equals `name` (any case) */
export function findAttributeByName(db: Db, name: string) {
  return db.attribute.findFirst({
    where: {
      OR: (['name', 'nameUz', 'nameEn'] as const).map((field) => ({
        [field]: { equals: name, mode: 'insensitive' as const },
      })),
    },
    select: ATTRIBUTE_SELECT,
  });
}

/** Products of the store (archived included — they can be restored) */
function brandProductsWhere(storeId: string, brandId: string) {
  return { storeId, brandId } satisfies Prisma.ProductWhereInput;
}

/** Products of the store using the attribute: on the card or in a variant's values */
function attributeProductsWhere(storeId: string, attributeId: string) {
  return {
    storeId,
    OR: [
      { attributes: { some: { attributeId } } },
      {
        variants: {
          some: { attributes: { some: { value: { attributeId } } } },
        },
      },
    ],
  } satisfies Prisma.ProductWhereInput;
}

/**
 * Store catalog for the platform ADMIN (docs: billing/docs/store-catalog/PLAN.md):
 * search the global brand / attribute dictionaries, connect them to a store one by one,
 * disconnect only those not used in the store's products (archived included).
 */
@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(AdminCatalogService.name)
    private readonly logger: PinoLogger,
  ) {}

  async searchBrands(
    params: CatalogSearchParams,
  ): Promise<CatalogList<CatalogBrand>> {
    const where: Prisma.BrandWhereInput = params.search
      ? { name: { contains: params.search, mode: 'insensitive' } }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.brand.findMany({
        where,
        select: { id: true, name: true, _count: { select: { stores: true } } },
        orderBy: [{ stores: { _count: 'desc' } }, { name: 'asc' }],
        take: params.pageSize ?? CATALOG_PAGE_SIZE,
      }),
      this.prisma.brand.count({ where }),
    ]);

    return {
      data: rows.map(({ _count, ...brand }) => ({
        ...brand,
        storeCount: _count.stores,
      })),
      total,
    };
  }

  async searchAttributes(
    params: CatalogSearchParams,
  ): Promise<CatalogList<CatalogAttribute>> {
    const search = params.search;
    const where: Prisma.AttributeWhereInput = search
      ? {
          OR: (['name', 'nameUz', 'nameEn'] as const).map((field) => ({
            [field]: { contains: search, mode: 'insensitive' as const },
          })),
        }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.attribute.findMany({
        where,
        select: { ...ATTRIBUTE_SELECT, _count: { select: { store: true } } },
        orderBy: [{ store: { _count: 'desc' } }, { name: 'asc' }],
        take: params.pageSize ?? CATALOG_PAGE_SIZE,
      }),
      this.prisma.attribute.count({ where }),
    ]);

    return {
      data: rows.map(({ _count, ...attr }) => ({
        ...attr,
        storeCount: _count.store,
      })),
      total,
    };
  }

  /** How many store products use each brand / attribute (archived included) */
  async usage(
    storeId: string,
    brandIds: string[],
    attributeIds: string[],
  ): Promise<{
    brands: Map<string, number>;
    attributes: Map<string, number>;
  }> {
    const [brandCounts, attributeCounts] = await Promise.all([
      Promise.all(
        brandIds.map((id) =>
          this.prisma.product.count({
            where: brandProductsWhere(storeId, id),
          }),
        ),
      ),
      Promise.all(
        attributeIds.map((id) =>
          this.prisma.product.count({
            where: attributeProductsWhere(storeId, id),
          }),
        ),
      ),
    ]);

    return {
      brands: new Map(brandIds.map((id, i) => [id, brandCounts[i]])),
      attributes: new Map(
        attributeIds.map((id, i) => [id, attributeCounts[i]]),
      ),
    };
  }

  async connectBrand(
    storeId: string,
    dto: ConnectStoreBrandDto,
    admin: CurrentUser,
  ): Promise<StoreBrand> {
    await this.assertStore(storeId);
    const brand = await this.prisma.$transaction(async (tx) => {
      const found = dto.brandId
        ? await tx.brand.findUnique({
            where: { id: dto.brandId },
            select: { id: true, name: true },
          })
        : await findOrCreateBrand(tx, dto.name as string);
      if (!found) {
        throw new NotFoundException('Brand not found');
      }
      await tx.brandsOnStore.createMany({
        data: [{ storeId, brandId: found.id }],
        skipDuplicates: true,
      });

      return found;
    });
    const productCount = await this.prisma.product.count({
      where: brandProductsWhere(storeId, brand.id),
    });
    this.logger.info(
      { storeId, brandId: brand.id, adminId: admin.id },
      'Brand connected to store',
    );

    return { ...brand, productCount };
  }

  async connectAttribute(
    storeId: string,
    dto: ConnectStoreAttributeDto,
    admin: CurrentUser,
  ): Promise<StoreAttribute> {
    await this.assertStore(storeId);
    const attribute = await this.prisma.$transaction(async (tx) => {
      let attr: AttributeRow | null;
      if (dto.attributeId) {
        attr = await tx.attribute.findUnique({
          where: { id: dto.attributeId },
          select: ATTRIBUTE_SELECT,
        });
        if (!attr) {
          throw new NotFoundException('Attribute not found');
        }
      } else {
        const input = dto.newAttribute!;
        const existing = await findAttributeByName(tx, input.name);
        if (existing) {
          // The client offers «Подключить его» with the existing attribute
          throw new ConflictException({
            message: `Attribute "${input.name}" already exists`,
            code: ATTRIBUTE_EXISTS_CODE,
            attribute: existing,
          });
        }
        attr = await tx.attribute.create({
          data: {
            name: input.name,
            nameUz: input.nameUz || null,
            nameEn: input.nameEn || null,
            type: input.type,
            unit:
              input.type === AttributeType.NUMBER ? (input.unit ?? null) : null,
          },
          select: ATTRIBUTE_SELECT,
        });
      }
      await tx.attributeOnStore.createMany({
        data: [{ storeId, attributeId: attr.id }],
        skipDuplicates: true,
      });

      return attr;
    });
    const productCount = await this.prisma.product.count({
      where: attributeProductsWhere(storeId, attribute.id),
    });
    this.logger.info(
      { storeId, attributeId: attribute.id, adminId: admin.id },
      'Attribute connected to store',
    );

    return { ...attribute, productCount };
  }

  async disconnectBrand(
    storeId: string,
    brandId: string,
    admin: CurrentUser,
  ): Promise<{ id: string }> {
    const link = await this.prisma.brandsOnStore.findUnique({
      where: { storeId_brandId: { storeId, brandId } },
    });
    if (!link) {
      throw new NotFoundException('Brand is not connected to the store');
    }
    const count = await this.prisma.product.count({
      where: brandProductsWhere(storeId, brandId),
    });
    this.assertNotUsed(count, 'Brand');
    await this.prisma.brandsOnStore.delete({
      where: { storeId_brandId: { storeId, brandId } },
    });
    this.logger.info(
      { storeId, brandId, adminId: admin.id },
      'Brand disconnected from store',
    );

    return { id: brandId };
  }

  async disconnectAttribute(
    storeId: string,
    attributeId: string,
    admin: CurrentUser,
  ): Promise<{ id: string }> {
    const link = await this.prisma.attributeOnStore.findUnique({
      where: { storeId_attributeId: { storeId, attributeId } },
    });
    if (!link) {
      throw new NotFoundException('Attribute is not connected to the store');
    }
    const count = await this.prisma.product.count({
      where: attributeProductsWhere(storeId, attributeId),
    });
    this.assertNotUsed(count, 'Attribute');
    await this.prisma.attributeOnStore.delete({
      where: { storeId_attributeId: { storeId, attributeId } },
    });
    this.logger.info(
      { storeId, attributeId, adminId: admin.id },
      'Attribute disconnected from store',
    );

    return { id: attributeId };
  }

  private assertNotUsed(count: number, what: 'Brand' | 'Attribute') {
    if (count > 0) {
      throw new ConflictException({
        message: `${what} is used in ${count} products of the store`,
        code: CATALOG_IN_USE_CODE,
        count,
      });
    }
  }

  private async assertStore(id: string) {
    const store = await this.prisma.store.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
  }
}
