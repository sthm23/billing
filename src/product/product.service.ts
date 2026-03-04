import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateProductDto, CreateProductVariantDto } from './dto/create-product.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma, Product, Staff, StockMovementReason, StockMovementType, User, UserRole } from '@generated/client';
import { buildSku } from '@shared/helper/sku-generator.helper';
import { generateEan13 } from '@shared/helper/bar-code-generator.helper';
import { CurrentUser } from '@auth/models/auth.model';

@Injectable()
export class ProductService {

  constructor(
    private prisma: PrismaService,
  ) { }

  async createProduct(dto: CreateProductDto) {
    try {
      const product = await this.prisma.product.create({
        data: {
          name: dto.name,
          storeId: dto.storeId,
          brandId: dto.brandId ?? null,
          categoryId: dto.categoryId ?? null,
          description: dto.description ?? null,
          images: {
            createMany: {
              data: dto.images.map((url, index) => ({
                url,
                isMain: index === 0,
              })),
            }
          },
          attributes: {
            createMany: {
              data: dto.attributeIds.map(id => ({ attributeId: id }))
            }
          },
          tags: {
            createMany: {
              data: dto.tagIds.map(id => ({ tagValueId: id }))
            }
          }
        }
      });
      return product;
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async createProductVariant(dto: CreateProductVariantDto, user: CurrentUser): Promise<Product> {
    try {
      const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
      if (!product) throw new NotFoundException("Product not found");
      const store = await this.prisma.store.findUnique({ where: { id: product.storeId } });
      if (!store) throw new NotFoundException("Store not found");

      await this.prisma.$transaction(async (tx) => {
        for (const variant of dto.variants) {

          const existingVariant = await tx.productVariant.findFirst({
            where: {
              productId: dto.productId,
              attributes: {
                some: {
                  attributeValueId: { in: variant.attributes.map(a => a.attributeValueId) }
                }
              }
            },
            include: {
              attributes: true,
            }
          });
          if (existingVariant) {
            this.prisma.productVariant.update({
              where: { id: existingVariant.id },
              data: {
                price: new Prisma.Decimal(variant.retailPrice),
                inventory: {
                  updateMany: {
                    where: { variantId: existingVariant.id },
                    data: { quantity: { increment: variant.quantity } }
                  }
                }
              }
            })
            continue; // пропускаем создание этого варианта и переходим к следующему
          }
          const barCode = await this.generateBarCode(tx, dto.productId, variant.barCode);
          await tx.productVariant.create({
            data: {
              productId: product.id,
              storeId: product.storeId, // важно: берем из product, не из dto
              sku: buildSku(product.name, dto.category, variant.attributes.map(a => a.value)),
              barCode,
              price: new Prisma.Decimal(variant.retailPrice),
              attributes: {
                createMany: {
                  data: variant.attributes.map(attr => ({ attributeValueId: attr.attributeValueId }))
                }
              },
              inventory: {
                create: {
                  quantity: variant.quantity,
                  warehouse: { connect: { id: dto.warehouseId } },
                }
              },
              stockMovements: {
                create: {
                  type: StockMovementType.IN,
                  reason: StockMovementReason.PURCHASE,
                  quantity: variant.quantity,
                  warehouse: { connect: { id: dto.warehouseId } },
                  createdBy: { connect: { id: user.staff.id } },
                  unitCost: new Prisma.Decimal(variant.costPrice),
                }
              },

            }
          })

        }
      })

      return Promise.resolve(product);
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  private async generateBarCode(tx: any, productId: string, barCode?: string): Promise<string> {
    const newBarcode = barCode?.trim() ? barCode.trim() : generateEan13();
    const existingBarCode = await tx.productVariant.findFirst({
      where: {
        productId: productId,
        barCode: newBarcode,
      }
    });
    if (existingBarCode) {
      // рекурсивно генерируем новый штрихкод, пока не найдем уникальный
      return this.generateBarCode(tx, productId);
    }
    return Promise.resolve(newBarcode);
  }

  async findAll(pageSize = 10, currentPage = 1, user: CurrentUser) {
    const skip = (currentPage - 1) * pageSize;
    try {
      const count = await this.prisma.product.count({
        where: { isArchived: false }
      });
      const where = user.role === UserRole.ADMIN ? { isArchived: false } : { storeId: user.staff.storeId, isArchived: false }
      const result = await this.prisma.product.findMany({
        skip: skip,
        take: +pageSize,
        where,
        include: {
          images: {
            select: {
              url: true,
              isMain: true,
              id: true,
            }
          },
          category: true,
          brand: true,
          tags: {
            include: {
              value: {
                include: {
                  tag: true
                }
              }
            }
          },
          variants: {
            include: {
              inventory: true,
            }
          }
        }
      });


      return {
        currentPage,
        pageSize,
        total: count,
        data: result.map(product => {
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
            variants: product.variants.map(v => ({
              id: v.id,
              price: v.price,
              quantity: v.inventory.reduce((acc, curr) => acc + curr.quantity, 0) || 0,
            })),
            name: product.name,
            id: product.id,
            images: product.images,
            createdAt: product.createdAt,
            storeId: product.storeId,
            isArchived: product.isArchived,
            description: product.description,
            tags: product.tags.map(t => ({
              id: t.value.id,
              value: t.value.value,
              tagId: t.value.tag.id,
              tagName: t.value.tag.name,
            })),
            priceRange: {
              min: minPrice,
              max: maxPrice,
            }
          }
        })
      };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async findOne(id: string) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
        include: {
          images: {
            select: {
              url: true,
              isMain: true,
              id: true,
            }
          },
          category: true,
          brand: true,
          attributes: {
            include: {
              attribute: true
            }
          },
          tags: {
            include: {
              value: {
                include: {
                  tag: true
                }
              }
            }
          },
          variants: {
            include: {
              attributes: {
                include: {
                  value: true,
                }
              },
              inventory: true,
              stockMovements: {
                include: {
                  createdBy: {
                    include: {
                      user: true
                    },
                  }
                },
              }
            }
          },
        }
      });
      if (!product) throw new NotFoundException('Product not found');
      const variants = product.variants.map(variant => {

        return {
          id: variant.id,
          sku: variant.sku,
          barCode: variant.barCode,
          price: variant.price,
          attributes: variant.attributes.map(a => ({
            id: a.value.id,
            value: a.value.valueString !== null ? a.value.valueString
              : a.value.valueBool !== null ? Boolean(a.value.valueBool)
                : a.value.valueNumber !== null ? Number(a.value.valueNumber) : null,
            attributeId: a.value.attributeId,
          })),
          quantity: variant.inventory.reduce((acc, curr) => acc + curr.quantity, 0) || 0,
          stockMovements: variant.stockMovements.map(movement => ({
            id: movement.id,
            type: movement.type,
            reason: movement.reason,
            warehouseId: movement.warehouseId,
            quantity: movement.quantity,
            unitCost: movement.unitCost,
            createdAt: movement.createdAt,
            createdBy: movement.createdBy ? {
              role: movement.createdBy.role,
              isActive: movement.createdBy.isActive,
              user: movement.createdBy.user ? movement.createdBy.user : null,
            } : null,
          }))
        }
      })
      return {
        id: product.id,
        name: product.name,
        brand: product.brand?.name,
        category: product.category?.name,
        description: product.description,
        images: product.images,
        attributes: product.attributes.map(a => ({ ...a.attribute })),
        isArchived: product.isArchived,
        createdAt: product.createdAt,
        storeId: product.storeId,
        tags: product.tags.map(t => ({
          id: t.value.id,
          value: t.value.value,
          tagId: t.value.tag.id,
          tagName: t.value.tag.name,
        })),
        variants,
      };
    } catch (error: any) {
      throw new ForbiddenException('Product not found: ' + error?.message);
    }
  }

  async findProductVariants(productId: string) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        include: {
          variants: true,
        }
      })
      if (!product) throw new NotFoundException('Product not found');
      return {
        ...product,
        variants: product.variants.map(v => ({

        }))
      };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async findAllVariants(pageSize = 10, currentPage = 1, user: CurrentUser) {
    try {
      const skip = (currentPage - 1) * pageSize;
      const where = user.role === UserRole.ADMIN ? {} : { storeId: user.staff.storeId }
      const count = await this.prisma.productVariant.count({ where });
      const variants = await this.prisma.productVariant.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          inventory: true,
          stockMovements: true
        }
      });
      return {
        count,
        currentPage,
        pageSize,
        data: variants.map(v => ({
          id: v.id,
          barCode: v.barCode,
          price: v.price,
          sku: v.sku,
          stockMovements: v.stockMovements.map(movement => ({
            id: movement.id,
            type: movement.type,
            reason: movement.reason,
            warehouseId: movement.warehouseId,
            quantity: movement.quantity,
            unitCost: movement.unitCost,
            createdAt: movement.createdAt,
          })),
          quantity: v.inventory.reduce((acc, curr) => acc + curr.quantity, 0) || 0,
        })),
      };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async remove(id: string) {

  }
}
