import {
  BadRequestException,
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
import { UpdateProductVariantPriceDTO } from './dto/update-product.dto';
import { ProductListParams } from './dto/product-list-params.dto';
import { LOW_STOCK_THRESHOLD } from './product.constants';

@Injectable()
export class ProductService {
  constructor(
    private prisma: PrismaService,
    private barcodeService: BarcodeService,
    @InjectPinoLogger(ProductService.name) private readonly logger: PinoLogger,
  ) {}

  async createProduct(
    dto: CreateProductDto,
    user: CurrentUser,
  ): Promise<Product> {
    try {
      const warehouse = await this.prisma.warehouse.findUnique({
        where: { id: dto.warehouseId },
      });
      if (!warehouse) throw new NotFoundException('Warehouse not found');

      const product = await this.prisma.product.create({
        data: {
          name: dto.name,
          warehouseId: dto.warehouseId,
          storeId: warehouse.storeId,
          brandId: dto.brandId ?? null,
          categoryId: dto.categoryId ?? null,
          description: dto.description ?? null,
          images: {
            createMany: {
              data: dto.images.map((url, index) => ({
                url,
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
      });
      if (!product) throw new NotFoundException('Product not found');
      const warehouse = await this.prisma.warehouse.findUnique({
        where: { id: product.warehouseId },
      });
      if (!warehouse) throw new NotFoundException('Warehouse not found');

      await this.prisma.$transaction(async (tx) => {
        for (const variant of dto.variants) {
          const barCode = await this.barcodeService.generateUniqueBarcode(tx);
          const newVariant = await tx.productVariant.create({
            data: {
              productId: product.id,
              warehouseId: product.warehouseId, // важно: берем из product, не из dto
              storeId: warehouse.storeId, // важно: берем из warehouse, не из dto
              sku: buildSku(
                product.name,
                dto.category,
                variant.attributes.map((a) => a.value),
              ),
              barCode,
              price: new Prisma.Decimal(variant.retailPrice),
            },
          });

          await tx.inventory.create({
            data: {
              quantity: variant.quantity,
              variantId: newVariant.id,
              warehouseId: warehouse.id,
            },
          });
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
      throw new BadRequestException(error.response || error.message);
    }
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
    try {
      const and: Prisma.ProductWhereInput[] = [{ isArchived: false }];
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
        // A chip is a top category: include products of its subcategories.
        and.push({
          OR: [
            { categoryId: params.categoryId },
            { category: { parentId: params.categoryId } },
            { category: { parent: { parentId: params.categoryId } } },
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
            select: {
              url: true,
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
            variants: product.variants.map((v) => ({
              id: v.id,
              price: v.price,
              quantity:
                v.inventory.reduce((acc, curr) => acc + curr.quantity, 0) || 0,
            })),
            name: product.name,
            id: product.id,
            images: product.images,
            createdAt: product.createdAt,
            warehouseId: product.warehouseId,
            warehouse: product.warehouse,
            isArchived: product.isArchived,
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
            select: {
              url: true,
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
      const variants = product.variants.map((variant) => {
        return {
          id: variant.id,
          sku: variant.sku,
          barCode: variant.barCode,
          price: variant.price,
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
            unitCost: movement.unitCost,
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
        description: product.description,
        images: product.images,
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
      return {
        currentPage,
        pageSize,
        total,
        data: movements.map((m) => ({
          id: m.id,
          type: m.type,
          reason: m.reason,
          quantity: m.quantity,
          unitCost: m.unitCost,
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
      return {
        count,
        currentPage,
        pageSize,
        data: variants.map((v) => ({
          id: v.id,
          barCode: v.barCode,
          price: v.price,
          sku: v.sku,
          stockMovements: v.stockMovements.map((movement) => ({
            id: movement.id,
            type: movement.type,
            reason: movement.reason,
            warehouseId: movement.warehouseId,
            quantity: movement.quantity,
            unitCost: movement.unitCost,
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
      return {
        count,
        currentPage,
        pageSize,
        data: variants.map((v) => ({
          id: v.id,
          barCode: v.barCode,
          price: v.price,
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
            unitCost: movement.unitCost,
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
      const warehouse = await this.prisma.warehouse.findUnique({
        where: { id: variant.warehouseId },
      });

      if (!warehouse) throw new NotFoundException('Warehouse not found');
      const hasAccess =
        user.role === UserRole.OWNER ||
        (user.staff && user.staff.role === StaffRole.MANAGER);

      if (
        hasAccess &&
        !user.staff.warehouse.some((w) => w.warehouseId === warehouse.id)
      ) {
        throw new ForbiddenException(
          'You do not have access to this warehouse',
        );
      }

      await this.prisma.productVariant.update({
        where: { id },
        data: {
          price: dto.price,
        },
      });
      this.logger.info({ variantId: id }, 'Product variant price updated');
      return { message: 'Product variant price updated successfully' };
    } catch (error: any) {
      this.logger.error(
        { variantId: id, err: error.message },
        'Failed to update product variant price',
      );
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
