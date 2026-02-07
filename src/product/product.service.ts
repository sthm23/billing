import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { CreateProductDto, CreateProductVariantDto } from './dto/create-product.dto';
import { FileHelper } from '@shared/helper/file.helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { S3Service } from 'src/prisma/s3.service';
import { Prisma, ProductVariant, Staff, UserRole } from '@generated/client';
import { buildSku } from '@shared/helper/sku-generator.helper';
import { generateEan13 } from '@shared/helper/bar-code-generator.helper';
import { UserAuth } from '@auth/models/auth.model';

@Injectable()
export class ProductService {

  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
  ) { }


  async createProduct(dto: CreateProductDto) {
    try {
      let product;
      await this.prisma.$transaction(async (tx) => {
        product = await tx.product.create({
          data: {
            name: dto.name,
            storeId: dto.storeId,
            brandId: dto.brand ?? null,
            categoryId: dto.category ?? null,
          },
          include: {
            images: true
          }
        })


        for (let i = 0; i < dto.images.length; i++) {
          const img = dto.images[i];
          const tempKey = img.split('/').slice(-2).join('/'); // Extract the key from the URL
          const permanentKey = `${dto.storeId}/${product.id}`;
          const url = await this.s3Service.moveToPermanentStorage(tempKey, permanentKey);
          const imgData = {
            productId: product.id,
            url,
            order: i,
            isMain: i === 0, // первая картинка - главная
          }
          await tx.productImage.create({
            data: imgData,
          })
        }
      });
      return Promise.resolve(product);
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

            await tx.variantAttributeValue.createMany({
              data: [
                { variantId: variant.id, attributeId: dto.color.attributeId, valueString: dto.color.value },
                { variantId: variant.id, attributeId: dto.size.attributeId, valueString: dto.size.value },
              ],
            });

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

  async handleFile(
    files: Express.Multer.File[]
  ): Promise<string[]> {
    try {
      const bufferArray: Promise<Buffer<ArrayBufferLike>>[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const originalBuffer = FileHelper.compressImage(file); // Читаем файл в память
        bufferArray.push(originalBuffer)
      }
      const arr = await Promise.all(bufferArray);
      const imgUrlArr: Promise<string>[] = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const buffer = arr[i];
        const fileName = FileHelper.createFileName(file);

        const url = this.s3Service.uploadFile({
          buffer: buffer,
          fileName: fileName,
          mimetype: file.mimetype
        })

        imgUrlArr.push(url)
      }
      return Promise.all(imgUrlArr);

    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async removeFile(productId: string, body: any, storeId: string): Promise<void> {

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
          images: true,
          category: true,
          brand: true,
        },
      });

      return {
        currentPage,
        pageSize,
        total: count,
        data: result
      };
    } catch (error: any) {
      throw new BadRequestException(error.response || error.message)
    }
  }

  async findOne(id: string) {
    try {
      const product = await this.prisma.product.findUnique({ where: { id } });
      if (!product) throw new NotFoundException('Product not found');

      return product;
    } catch (error: any) {
      throw new ForbiddenException('Product not found: ' + error?.message);
    }
  }

  async remove(id: string) {

  }
}
