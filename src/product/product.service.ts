import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateProductDto, CreateProductVariantDto } from './dto/create-product.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma, Product, ProductVariant, Staff, StockMovementReason, StockMovementType, User, UserRole } from '@generated/client';
import { buildSku } from '@shared/helper/sku-generator.helper';
import { generateEan13 } from '@shared/helper/bar-code-generator.helper';
import { UserAuth } from '@auth/models/auth.model';

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
          }
        }
      });
      return product;
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async createProductVariant(dto: CreateProductVariantDto, user: User & { staff: Staff }): Promise<Product> {
    try {
      const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
      if (!product) throw new NotFoundException("Product not found");
      const store = await this.prisma.store.findUnique({ where: { id: product.storeId } });
      if (!store) throw new NotFoundException("Store not found");

      await this.prisma.$transaction(async (tx) => {
        for (const variant of dto.variants) {
          await tx.productVariant.create({
            data: {
              productId: product.id,
              storeId: product.storeId, // важно: берем из product, не из dto
              sku: buildSku(product.name, dto.category, variant.attributes.map(a => a.value)),
              barCode: variant.barCode?.trim() ? variant.barCode.trim() : generateEan13(),
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

  async findAll(pageSize = 10, currentPage = 1, user: UserAuth & { staff: Staff }) {
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
          variants: {
            include: {
              attributes: {
                include: {
                  value: true,
                }
              },
              inventory: true,
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
        }
      })
      return {
        id: product.id,
        name: product.name,
        brand: product.brand?.name,
        category: product.category?.name,
        images: product.images,
        attributes: product.attributes.map(a => ({ ...a.attribute })),
        isArchived: product.isArchived,
        createdAt: product.createdAt,
        storeId: product.storeId,
        variants,
      };
    } catch (error: any) {
      throw new ForbiddenException('Product not found: ' + error?.message);
    }
  }

  async remove(id: string) {

  }
}
