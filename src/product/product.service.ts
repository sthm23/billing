import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  CreateProductDto,
  CreateProductVariantDto,
} from './dto/create-product.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  Prisma,
  Product,
  StaffRole,
  StockMovementReason,
  StockMovementType,
  UserRole,
} from '@generated/client';
import { buildSku } from '@shared/helper/sku-generator.helper';
import { CurrentUser } from '@auth/models/auth.model';
import { BarcodeService } from '@shared/helper/bar-code.service';
import { canSeeCost } from '@shared/helper/role.helper';
import { UpdateProductVariantPriceDTO } from './dto/update-product.dto';
import { ProductListParams } from './dto/product-list-params.dto';
import { LOW_STOCK_THRESHOLD } from './product.constants';
import { assertWarehouseAccess } from '@shared/helper/warehouse-access.helper';
import { S3Service } from '@prisma/s3.service';
import {
  FileHelper,
  PRODUCT_IMAGE_MAX_COUNT,
  PRODUCT_IMAGE_MAX_SIZE,
  PRODUCT_IMAGE_MIME_TYPES,
} from '@shared/helper/file.helper';

/** Owner (user or staff role), manager or admin — may edit products and finish drafts. */
function canManageProducts(user: CurrentUser): boolean {
  return (
    user.role === UserRole.ADMIN ||
    user.role === UserRole.OWNER ||
    user.staff?.role === StaffRole.OWNER ||
    user.staff?.role === StaffRole.MANAGER
  );
}

/** Category label in every language; the client picks one (falls back to `name`, Russian). */
function categoryI18n(
  category: {
    name: string;
    nameUz: string | null;
    nameEn: string | null;
  } | null,
) {
  return category
    ? { name: category.name, nameUz: category.nameUz, nameEn: category.nameEn }
    : null;
}

@Injectable()
export class ProductService {
  constructor(
    private prisma: PrismaService,
    private barcodeService: BarcodeService,
    private s3Service: S3Service,
    @InjectPinoLogger(ProductService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Client image values (keys, or full URLs under S3_PUBLIC_URL from the legacy web) → object keys.
   * Each key must be under `products/<storeId>/` and already uploaded (HEAD): image type, ≤ 5 MB.
   */
  private async resolveImageKeys(
    images: string[],
    storeId: string,
  ): Promise<string[]> {
    if (images.length > PRODUCT_IMAGE_MAX_COUNT) {
      throw new BadRequestException(
        `At most ${PRODUCT_IMAGE_MAX_COUNT} images per product`,
      );
    }
    const prefix = FileHelper.productImagePrefix(storeId);
    const keys = images.map((value) => {
      const key = FileHelper.toKey(value);
      if (!key || !key.startsWith(prefix) || key.includes('..')) {
        throw new BadRequestException('Invalid product image');
      }
      return key;
    });
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('Duplicate product image');
    }
    const heads = await Promise.all(
      keys.map((key) => this.s3Service.headObject(key)),
    );
    heads.forEach((head) => {
      if (!head) throw new BadRequestException('Product image is not uploaded');
      if (head.size > PRODUCT_IMAGE_MAX_SIZE) {
        throw new BadRequestException('Image must be 5 MB or smaller');
      }
      if (!PRODUCT_IMAGE_MIME_TYPES.includes(head.contentType)) {
        throw new BadRequestException(
          'Only JPEG, PNG or WebP images are allowed',
        );
      }
    });
    return keys;
  }

  /** DB image rows (key) → API shape (url) */
  private toImageResponse(
    images: { id: string; key: string; isMain: boolean }[],
  ) {
    return images.map(({ key, ...image }) => ({
      ...image,
      url: FileHelper.toPublicUrl(key),
    }));
  }

  async createProduct(
    dto: CreateProductDto,
    user: CurrentUser,
  ): Promise<Product> {
    // The warehouse must belong to the caller's store (403 before the try)
    await assertWarehouseAccess(this.prisma, user, dto.warehouseId);
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: dto.warehouseId },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    await this.assertStoreSubcategory(dto.categoryId, warehouse.storeId);
    const imageKeys = await this.resolveImageKeys(
      dto.images ?? [],
      warehouse.storeId,
    );
    try {
      const product = await this.prisma.product.create({
        data: {
          name: dto.name,
          warehouseId: dto.warehouseId,
          storeId: warehouse.storeId,
          brandId: dto.brandId ?? null,
          categoryId: dto.categoryId,
          description: dto.description ?? null,
          images: {
            createMany: {
              data: imageKeys.map((key, index) => ({
                key,
                order: index,
                isMain: index === 0,
              })),
            },
          },
          attributes: {
            createMany: {
              data: dto.attributeIds.map((id) => ({ attributeId: id })),
            },
          },
          tags: {
            createMany: {
              data: dto.tagIds.map((id) => ({ tagValueId: id })),
            },
          },
        },
      });
      this.logger.info(
        { productId: product.id, warehouseId: dto.warehouseId },
        'Product created',
      );
      return product;
    } catch (error: any) {
      this.logger.error(
        { warehouseId: dto.warehouseId, err: error.message },
        'Failed to create product',
      );
      throw new BadRequestException(error.response || error.message);
    }
  }

  async createProductVariant(
    dto: CreateProductVariantDto,
    user: CurrentUser,
  ): Promise<Product> {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id: dto.productId },
        include: {
          category: { select: { name: true } },
          attributes: { select: { attributeId: true } },
        },
      });
      if (!product) throw new NotFoundException('Product not found');
      this.assertWarehouseAccess(product.storeId, product.warehouseId, user);
      // SKU uses the category name from the DB, never the client's `dto.category`
      const categoryName = product.category?.name ?? '';
      const warehouse = await this.prisma.warehouse.findUnique({
        where: { id: product.warehouseId },
      });
      if (!warehouse) throw new NotFoundException('Warehouse not found');

      const saleRentByVariant = dto.variants.map((v) =>
        this.resolveSaleRent(v),
      );
      const valueById = await this.assertVariantAttributes(
        product.id,
        (product.attributes ?? []).map((a) => a.attributeId),
        dto.variants.map((v) => v.attributes.map((a) => a.attributeValueId)),
      );
      const manualCodes = await this.assertManualBarcodes(
        dto.variants.map((v) => v.barCode),
        warehouse.storeId,
      );
      if (dto.variants.some((v) => v.quantity > 0) && !user.staff?.id) {
        throw new BadRequestException(
          'Initial stock requires a staff account (it creates a stock receipt)',
        );
      }

      await this.prisma.$transaction(async (tx) => {
        for (const [index, variant] of dto.variants.entries()) {
          const barCode =
            manualCodes[index] ??
            (await this.generateStoreBarcode(
              tx,
              warehouse.storeId,
              manualCodes,
            ));
          const newVariant = await tx.productVariant.create({
            data: {
              productId: product.id,
              warehouseId: product.warehouseId, // важно: берем из product, не из dto
              storeId: warehouse.storeId, // важно: берем из warehouse, не из dto
              sku: buildSku(
                product.name,
                categoryName,
                // values from the DB, in the client's attribute order
                variant.attributes.map(
                  (a) => valueById.get(a.attributeValueId) ?? a.value,
                ),
              ),
              barCode,
              price: new Prisma.Decimal(variant.retailPrice),
              ...saleRentByVariant[index],
            },
          });

          await tx.inventory.create({
            data: {
              quantity: variant.quantity,
              variantId: newVariant.id,
              warehouseId: warehouse.id,
            },
          });
          // qty 0 = future goods: no receipt yet, the cost is recorded with the first «Приход»
          if (variant.quantity > 0) {
            await tx.stockMovement.create({
              data: {
                type: StockMovementType.IN,
                reason: StockMovementReason.PURCHASE,
                quantity: variant.quantity,
                variantId: newVariant.id,
                warehouseId: warehouse.id,
                unitCost: new Prisma.Decimal(variant.costPrice),
                createdById: user.staff.id,
              },
            });
          }
          await tx.variantAttributeValue.createMany({
            data: variant.attributes.map((attr) => ({
              attributeValueId: attr.attributeValueId,
              variantId: newVariant.id,
            })),
          });
        }
      });

      this.logger.info(
        { productId: product.id, variantCount: dto.variants.length },
        'Product variants created',
      );
      return Promise.resolve(product);
    } catch (error: any) {
      this.logger.error(
        { productId: dto.productId, err: error.message },
        'Failed to create product variants',
      );
      if (
        error instanceof ForbiddenException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      // Two requests raced for the same manual barcode
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Barcode is already used in this store');
      }
      throw new BadRequestException(error.response || error.message);
    }
  }

  /**
   * Every value must belong to one of the product's attributes, at most one
   * value per attribute in a variant, and no two variants (new or existing)
   * may have the same value set. Returns value id → display value (for the SKU).
   */
  private async assertVariantAttributes(
    productId: string,
    productAttributeIds: string[],
    valueIdsByVariant: string[][],
  ): Promise<Map<string, string | number>> {
    const allIds = [...new Set(valueIdsByVariant.flat())];
    const values = allIds.length
      ? await this.prisma.attributeValue.findMany({
          where: { id: { in: allIds } },
        })
      : [];
    const attributeOf = new Map(values.map((v) => [v.id, v.attributeId]));
    const allowed = new Set(productAttributeIds);
    for (const id of allIds) {
      const attributeId = attributeOf.get(id);
      if (!attributeId || !allowed.has(attributeId)) {
        throw new BadRequestException(
          'Variant attribute value does not belong to the product attributes',
        );
      }
    }
    for (const ids of valueIdsByVariant) {
      const attrs = ids.map((id) => attributeOf.get(id));
      if (new Set(attrs).size !== attrs.length) {
        throw new BadRequestException(
          'A variant can have only one value per attribute',
        );
      }
    }

    const keyOf = (ids: string[]) => [...new Set(ids)].sort().join('|');
    const existing = await this.prisma.productVariant.findMany({
      where: { productId },
      select: { attributes: { select: { attributeValueId: true } } },
    });
    const seen = new Set(
      existing.map((v) => keyOf(v.attributes.map((a) => a.attributeValueId))),
    );
    for (const ids of valueIdsByVariant) {
      const key = keyOf(ids);
      if (seen.has(key)) {
        throw new BadRequestException(
          'A variant with the same attribute values already exists',
        );
      }
      seen.add(key);
    }

    return new Map(
      values.map((v) => [
        v.id,
        v.valueString ??
          (v.valueNumber !== null
            ? Number(v.valueNumber)
            : String(Boolean(v.valueBool))),
      ]),
    );
  }

  /**
   * Manual barcodes (index → code, empty → undefined): no duplicates in the
   * request (400), free in the store (409).
   */
  private async assertManualBarcodes(
    codes: (string | undefined)[],
    storeId: string,
  ): Promise<(string | undefined)[]> {
    const normalized = codes.map((c) => c?.trim() || undefined);
    const given = normalized.filter((c): c is string => !!c);
    if (new Set(given).size !== given.length) {
      throw new BadRequestException(
        'The same barcode is used for two variants',
      );
    }
    if (given.length) {
      const taken = await this.prisma.productVariant.findFirst({
        where: { storeId, barCode: { in: given } },
        select: { barCode: true },
      });
      if (taken) {
        throw new ConflictException(
          `Barcode ${taken.barCode} is already used in this store`,
        );
      }
    }
    return normalized;
  }

  /** Next generated barcode that is not taken in the store (a manual code may sit in the 2… range). */
  private async generateStoreBarcode(
    tx: Prisma.TransactionClient,
    storeId: string,
    reserved: (string | undefined)[],
  ): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = await this.barcodeService.generateUniqueBarcode(tx);
      if (reserved.includes(code)) continue;
      const taken = await tx.productVariant.findFirst({
        where: { storeId, barCode: code },
        select: { id: true },
      });
      if (!taken) return code;
    }
    throw new ConflictException('Could not generate a free barcode, try again');
  }

  /**
   * Sale/rent flags of a variant: omitted fields keep `current` (or the
   * defaults canSell = true, canRent = false). A rentable variant needs a
   * positive rent price per day.
   */
  /**
   * A product's category must be a subcategory (level 2) of one of the store's directions.
   * Throws 400 before the create `try`.
   */
  private async assertStoreSubcategory(categoryId: string, storeId: string) {
    const category = await this.prisma.category.findFirst({
      where: {
        id: categoryId,
        parent: { parentId: null, store: { some: { storeId } } },
      },
      select: { id: true },
    });
    if (!category) {
      throw new BadRequestException(
        'Category must be a subcategory of the store direction',
      );
    }
  }

  private resolveSaleRent(
    input: {
      canSell?: boolean;
      canRent?: boolean;
      rentPricePerDay?: number;
      defaultCleaningDays?: number;
    },
    current?: {
      canSell: boolean;
      canRent: boolean;
      rentPricePerDay: Prisma.Decimal | null;
      defaultCleaningDays: number;
    },
  ) {
    const canSell = input.canSell ?? current?.canSell ?? true;
    const canRent = input.canRent ?? current?.canRent ?? false;
    const rentPricePerDay =
      input.rentPricePerDay !== undefined
        ? new Prisma.Decimal(input.rentPricePerDay)
        : (current?.rentPricePerDay ?? null);
    if (canRent && (!rentPricePerDay || rentPricePerDay.lte(0))) {
      throw new BadRequestException(
        'A rentable variant requires a rent price per day greater than 0',
      );
    }
    const defaultCleaningDays =
      input.defaultCleaningDays ?? current?.defaultCleaningDays ?? 1;
    return { canSell, canRent, rentPricePerDay, defaultCleaningDays };
  }

  /**
   * Staff work only with their store; everyone but the owner only with their
   * warehouses. An admin may access any product.
   */
  private assertWarehouseAccess(
    storeId: string,
    warehouseId: string,
    user: CurrentUser,
  ) {
    if (user.role === UserRole.ADMIN) return;
    if (!user.staff || user.staff.storeId !== storeId) {
      throw new ForbiddenException('No access to this product');
    }
    if (user.role === UserRole.OWNER || user.staff.role === StaffRole.OWNER) {
      return;
    }
    if (!user.staff.warehouse.some((w) => w.warehouseId === warehouseId)) {
      throw new ForbiddenException('No access to this product');
    }
  }

  /** Ids of matching products whose total stock is at or below the threshold. */
  private async findLowStockProductIds(where: Prisma.ProductWhereInput) {
    const products = await this.prisma.product.findMany({
      where,
      select: {
        id: true,
        variants: { select: { inventory: { select: { quantity: true } } } },
      },
    });
    const lowIds = products
      .filter((p) => {
        // A draft (no variants yet) is not «low stock» — it has no goods at all
        if (p.variants.length === 0) return false;
        const total = p.variants.reduce(
          (acc, v) => acc + v.inventory.reduce((s, i) => s + i.quantity, 0),
          0,
        );
        return total <= LOW_STOCK_THRESHOLD;
      })
      .map((p) => p.id);
    return { all: products.length, lowIds };
  }

  async findAll(params: ProductListParams, user: CurrentUser) {
    const pageSize = params.pageSize ?? 10;
    const currentPage = params.currentPage ?? 1;
    const skip = (currentPage - 1) * pageSize;
    if (params.warehouseId) {
      await assertWarehouseAccess(this.prisma, user, params.warehouseId);
    }
    try {
      const and: Prisma.ProductWhereInput[] = [{ isArchived: false }];
      if (params.warehouseId) and.push({ warehouseId: params.warehouseId });
      if (user.role !== UserRole.ADMIN) {
        if (!user.staff) throw new ForbiddenException('Staff only');
        and.push({ storeId: user.staff.storeId });
        if (
          user.role !== UserRole.OWNER &&
          user.staff.role !== StaffRole.OWNER
        ) {
          and.push({
            warehouseId: {
              in: user.staff.warehouse.map((w) => w.warehouseId),
            },
          });
        }
        // Drafts (cards without variants) are for those who finish them: owner / manager
        if (!canManageProducts(user)) and.push({ variants: { some: {} } });
      }
      const search = params.search?.trim();
      if (search) {
        and.push({
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            {
              variants: {
                some: {
                  OR: [
                    { sku: { contains: search, mode: 'insensitive' } },
                    { barCode: { contains: search } },
                  ],
                },
              },
            },
          ],
        });
      }
      if (params.categoryId) {
        // A direction chip includes products of its subcategories (two levels only).
        and.push({
          OR: [
            { categoryId: params.categoryId },
            { category: { parentId: params.categoryId } },
          ],
        });
      }

      // Counts for the «Все» / «Мало» chips: same search and category, without lowStock.
      const { all, lowIds } = await this.findLowStockProductIds({ AND: and });
      const where: Prisma.ProductWhereInput = params.lowStock
        ? { AND: [...and, { id: { in: lowIds } }] }
        : { AND: and };
      const count = params.lowStock ? lowIds.length : all;

      const result = await this.prisma.product.findMany({
        skip: skip,
        take: +pageSize,
        where,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          images: {
            orderBy: [{ isMain: 'desc' }, { order: 'asc' }],
            select: {
              key: true,
              isMain: true,
              id: true,
            },
          },
          category: true,
          brand: true,
          warehouse: true,
          tags: {
            include: {
              value: {
                include: {
                  tag: true,
                },
              },
            },
          },
          variants: {
            include: {
              inventory: true,
            },
          },
        },
      });

      return {
        currentPage,
        pageSize,
        total: count,
        counts: { all, lowStock: lowIds.length },
        lowStockThreshold: LOW_STOCK_THRESHOLD,
        data: result.map((product) => {
          let minPrice: Prisma.Decimal | null = null;
          let maxPrice: Prisma.Decimal | null = null;
          for (const v of product.variants) {
            const p = v.price;
            if (!minPrice || p.lt(minPrice)) minPrice = p;
            if (!maxPrice || p.gt(maxPrice)) maxPrice = p;
          }
          return {
            brand: product.brand?.name,
            category: product.category?.name,
            categoryI18n: categoryI18n(product.category),
            variants: product.variants.map((v) => ({
              id: v.id,
              price: v.price,
              canSell: v.canSell,
              canRent: v.canRent,
              rentPricePerDay: v.rentPricePerDay,
              defaultCleaningDays: v.defaultCleaningDays,
              quantity:
                v.inventory.reduce((acc, curr) => acc + curr.quantity, 0) || 0,
            })),
            name: product.name,
            id: product.id,
            images: this.toImageResponse(product.images),
            createdAt: product.createdAt,
            warehouseId: product.warehouseId,
            warehouse: product.warehouse,
            isArchived: product.isArchived,
            /** Card created, variants not yet — the client opens step 2 */
            isDraft: product.variants.length === 0,
            description: product.description,
            tags: product.tags.map((t) => ({
              id: t.value.id,
              value: t.value.value,
              tagId: t.value.tag.id,
              tagName: t.value.tag.name,
            })),
            priceRange: {
              min: minPrice,
              max: maxPrice,
            },
          };
        }),
      };
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new BadRequestException(error.response || error.message);
    }
  }

  async findOne(id: string, user: CurrentUser) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
        include: {
          images: {
            orderBy: [{ isMain: 'desc' }, { order: 'asc' }],
            select: {
              key: true,
              isMain: true,
              id: true,
            },
          },
          category: true,
          brand: true,
          attributes: {
            include: {
              attribute: true,
            },
          },
          tags: {
            include: {
              value: {
                include: {
                  tag: true,
                },
              },
            },
          },
          warehouse: true,
          variants: {
            include: {
              attributes: {
                include: {
                  value: true,
                },
              },
              inventory: true,
              stockMovements: {
                include: {
                  createdBy: {
                    include: {
                      user: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!product) throw new NotFoundException('Product not found');
      this.assertWarehouseAccess(product.storeId, product.warehouseId, user);
      const showCost = canSeeCost(user);
      const variants = product.variants.map((variant) => {
        return {
          id: variant.id,
          sku: variant.sku,
          barCode: variant.barCode,
          price: variant.price,
          canSell: variant.canSell,
          canRent: variant.canRent,
          rentPricePerDay: variant.rentPricePerDay,
          defaultCleaningDays: variant.defaultCleaningDays,
          attributes: variant.attributes.map((a) => ({
            id: a.value.id,
            value:
              a.value.valueString !== null
                ? a.value.valueString
                : a.value.valueBool !== null
                  ? Boolean(a.value.valueBool)
                  : a.value.valueNumber !== null
                    ? Number(a.value.valueNumber)
                    : null,
            attributeId: a.value.attributeId,
          })),
          quantity:
            variant.inventory.reduce((acc, curr) => acc + curr.quantity, 0) ||
            0,
          stockMovements: variant.stockMovements.map((movement) => ({
            id: movement.id,
            type: movement.type,
            reason: movement.reason,
            warehouseId: movement.warehouseId,
            quantity: movement.quantity,
            unitCost: showCost ? movement.unitCost : null,
            createdAt: movement.createdAt,
            createdBy: movement.createdBy
              ? {
                  role: movement.createdBy.role,
                  isActive: movement.createdBy.isActive,
                  user: movement.createdBy.user
                    ? movement.createdBy.user
                    : null,
                }
              : null,
          })),
        };
      });
      return {
        id: product.id,
        name: product.name,
        brand: product.brand?.name,
        category: product.category?.name,
        categoryI18n: categoryI18n(product.category),
        description: product.description,
        images: this.toImageResponse(product.images),
        attributes: product.attributes.map((a) => ({ ...a.attribute })),
        isArchived: product.isArchived,
        createdAt: product.createdAt,
        warehouseId: product.warehouseId,
        warehouse: product.warehouse,
        tags: product.tags.map((t) => ({
          id: t.value.id,
          value: t.value.value,
          tagId: t.value.tag.id,
          tagName: t.value.tag.name,
        })),
        variants,
      };
    } catch (error: any) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new ForbiddenException('Product not found: ' + error?.message);
    }
  }

  /** Stock movements of one variant, newest first. */
  async findStockMovements(
    variantId: string,
    pageSize = 20,
    currentPage = 1,
    user: CurrentUser,
  ) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { storeId: true, warehouseId: true },
    });
    if (!variant) throw new NotFoundException('Product variant not found');
    this.assertWarehouseAccess(variant.storeId, variant.warehouseId, user);

    try {
      const skip = (+currentPage - 1) * +pageSize;
      const where: Prisma.StockMovementWhereInput = { variantId };
      const [total, movements] = await Promise.all([
        this.prisma.stockMovement.count({ where }),
        this.prisma.stockMovement.findMany({
          where,
          skip,
          take: +pageSize,
          orderBy: { createdAt: 'desc' },
          include: {
            createdBy: { select: { user: { select: { fullName: true } } } },
          },
        }),
      ]);
      const showCost = canSeeCost(user);
      return {
        currentPage,
        pageSize,
        total,
        data: movements.map((m) => ({
          id: m.id,
          type: m.type,
          reason: m.reason,
          quantity: m.quantity,
          unitCost: showCost ? m.unitCost : null,
          createdAt: m.createdAt,
          createdBy: m.createdBy?.user?.fullName ?? null,
        })),
      };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  async findAllVariants(pageSize = 10, currentPage = 1, user: CurrentUser) {
    try {
      const skip = (currentPage - 1) * pageSize;
      const where =
        user.role === UserRole.ADMIN ? {} : { storeId: user.staff.storeId };
      const count = await this.prisma.productVariant.count({ where });
      const variants = await this.prisma.productVariant.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          inventory: true,
          stockMovements: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });
      const showCost = canSeeCost(user);
      return {
        count,
        currentPage,
        pageSize,
        data: variants.map((v) => ({
          id: v.id,
          barCode: v.barCode,
          price: v.price,
          canSell: v.canSell,
          canRent: v.canRent,
          rentPricePerDay: v.rentPricePerDay,
          defaultCleaningDays: v.defaultCleaningDays,
          sku: v.sku,
          stockMovements: v.stockMovements.map((movement) => ({
            id: movement.id,
            type: movement.type,
            reason: movement.reason,
            warehouseId: movement.warehouseId,
            quantity: movement.quantity,
            unitCost: showCost ? movement.unitCost : null,
            createdAt: movement.createdAt,
          })),
          quantity:
            v.inventory.reduce((acc, curr) => acc + curr.quantity, 0) || 0,
        })),
      };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message);
    }
  }

  async search(
    pageSize = 20,
    currentPage = 1,
    text: string,
    warehouseId: string,
    user: CurrentUser,
  ) {
    try {
      const skip = (+currentPage - 1) * +pageSize;
      const where: Prisma.ProductVariantWhereInput = {
        warehouseId,
        // Archived products cannot be sold
        product: { isArchived: false },
        OR: [
          { barCode: { contains: text, mode: 'insensitive' } },
          { sku: { contains: text, mode: 'insensitive' } },
          { product: { name: { contains: text, mode: 'insensitive' } } },
        ],
      };
      // Сотрудник ищет только по своему складу своего магазина; админ — по любому складу
      if (user.role !== UserRole.ADMIN) {
        const ids = user.staff
          ? user.staff.warehouse.map((w) => w.warehouseId)
          : [];
        if (!user.staff || !ids.includes(warehouseId)) {
          throw new ForbiddenException('No access to this warehouse');
        }
        where.storeId = user.staff.storeId;
      }

      const count = await this.prisma.productVariant.count({ where });
      const variants = await this.prisma.productVariant.findMany({
        where,
        skip,
        take: +pageSize,
        include: {
          inventory: true,
          stockMovements: true,
          product: { select: { id: true, name: true } },
          attributes: {
            include: {
              value: { include: { attribute: { select: { name: true } } } },
            },
          },
        },
      });
      const showCost = canSeeCost(user);
      return {
        count,
        currentPage,
        pageSize,
        data: variants.map((v) => ({
          id: v.id,
          barCode: v.barCode,
          price: v.price,
          canSell: v.canSell,
          canRent: v.canRent,
          rentPricePerDay: v.rentPricePerDay,
          defaultCleaningDays: v.defaultCleaningDays,
          sku: v.sku,
          productId: v.product.id,
          productName: v.product.name,
          attributes: v.attributes.map((a) => ({
            name: a.value.attribute.name,
            value:
              a.value.valueString ??
              a.value.valueNumber?.toString() ??
              (a.value.valueBool === null ? null : String(a.value.valueBool)),
          })),
          stockMovements: v.stockMovements.map((movement) => ({
            id: movement.id,
            type: movement.type,
            reason: movement.reason,
            warehouseId: movement.warehouseId,
            quantity: movement.quantity,
            unitCost: showCost ? movement.unitCost : null,
            createdAt: movement.createdAt,
          })),
          quantity:
            v.inventory.reduce((acc, curr) => acc + curr.quantity, 0) || 0,
        })),
      };
    } catch (error: any) {
      if (error instanceof ForbiddenException) throw error;
      throw new BadRequestException(error.response || error.message);
    }
  }

  async updateProductVariant(
    id: string,
    dto: UpdateProductVariantPriceDTO,
    user: CurrentUser,
  ) {
    try {
      const variant = await this.prisma.productVariant.findUnique({
        where: { id },
      });
      if (!variant) throw new NotFoundException('Product variant not found');
      // Own store; a non-owner also needs the variant's warehouse
      this.assertWarehouseAccess(variant.storeId, variant.warehouseId, user);

      await this.prisma.productVariant.update({
        where: { id },
        data: {
          price: dto.price,
          ...this.resolveSaleRent(dto, variant),
        },
      });
      this.logger.info({ variantId: id }, 'Product variant price updated');
      return { message: 'Product variant price updated successfully' };
    } catch (error: any) {
      this.logger.error(
        { variantId: id, err: error.message },
        'Failed to update product variant price',
      );
      if (error instanceof ForbiddenException) throw error;
      throw new BadRequestException(error.response || error.message);
    }
  }

  async remove(id: string, user: CurrentUser) {
    try {
      const product = await this.prisma.product.findUnique({ where: { id } });
      if (!product) throw new NotFoundException('Product not found');
      this.assertWarehouseAccess(product.storeId, product.warehouseId, user);
      await this.prisma.product.update({
        where: { id },
        data: {
          isArchived: true,
        },
      });
      this.logger.info({ productId: id }, 'Product archived');
      return { message: 'Product archived successfully' };
    } catch (error: any) {
      this.logger.error(
        { productId: id, err: error.message },
        'Failed to archive product',
      );
      if (error instanceof ForbiddenException) throw error;
      throw new BadRequestException(error.response || error.message);
    }
  }
}
