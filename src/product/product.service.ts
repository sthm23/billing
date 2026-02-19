import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateProductDto, CreateProductVariantDto } from './dto/create-product.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma, ProductVariant, Staff, UserRole } from '@generated/client';
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

  async createProductVariant(dto: CreateProductVariantDto): Promise<ProductVariant> {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException("Product not found");

    try {
      const baseSku = dto.sku?.trim()
        ? dto.sku.trim().toUpperCase()
        : buildSku(product.name, dto.color.value, dto.size.value);

      for (let attempt = 0; attempt < 10; attempt++) {
        const sku = attempt === 0 ? baseSku : `${baseSku}-${attempt + 1}`;
        const barCode = dto.barCode?.trim() ? dto.barCode.trim() : generateEan13();

        try {
          return await this.prisma.$transaction(async (tx) => {
            // (опционально) если хочешь избежать дублей barCode даже без unique в БД:
            const existing = await tx.productVariant.findFirst({ where: { barCode } });
            if (existing) throw new Error("BARCODE_COLLISION");

            const variant = await tx.productVariant.create({
              data: {
                productId: product.id,
                storeId: product.storeId, // важно: берем из product, не из dto
                sku,
                barCode,
                price: new Prisma.Decimal(dto.price),
              },
            });

            // await tx.variantAttributeValue.createMany({
            //   data: [
            //     { variantId: variant.id, attributeId: dto.color.attributeId, valueString: dto.color.value },
            //     { variantId: variant.id, attributeId: dto.size.attributeId, valueString: dto.size.value },
            //   ],
            // });

            return variant;
          });
        } catch (e: any) {
          // уникальность SKU (storeId+sku)
          if (e?.code === "P2002") continue;
          if (e?.message === "BARCODE_COLLISION") continue;
          throw new BadRequestException(e?.message ?? "Create variant failed");
        }
      }

      throw new BadRequestException("Failed to generate unique SKU/barCode after retries");
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async findAll(pageSize = 10, currentPage = 1, user: UserAuth & { staff: Staff }) {
    const skip = (currentPage - 1) * pageSize;
    try {
      const count = await this.prisma.product.count();
      const result = await this.prisma.product.findMany({
        skip: skip,
        take: +pageSize,
        where: user.role === UserRole.ADMIN ? {} : { storeId: user.staff.storeId },
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
          _count: { select: { variants: true } },
        }
      });

      return {
        currentPage,
        pageSize,
        total: count,
        data: result.map(product => ({
          brand: product.brand?.name,
          category: product.category?.name,
          variants: product._count.variants,
          name: product.name,
          id: product.id,
          images: product.images,
          createdAt: product.createdAt,
          storeId: product.storeId,
          isArchived: product.isArchived,
        }))
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
          attributes: true,
          variants: true,
        }
      });
      if (!product) throw new NotFoundException('Product not found');

      return {
        id: product.id,
        name: product.name,
        brand: product.brand?.name,
        category: product.category?.name,
        images: product.images,
        attributes: product.attributes,
        variants: product.variants,
        isArchived: product.isArchived,
        createdAt: product.createdAt,
        storeId: product.storeId,
      };
    } catch (error: any) {
      throw new ForbiddenException('Product not found: ' + error?.message);
    }
  }

  async remove(id: string) {

  }
}
