import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { CreateProductDto, CreateProductVariantDto } from './dto/create-product.dto';
import { FileHelper } from '@shared/helper/file.helper';
import { ProductSold } from '@shared/model/product.model';
import { PrismaService } from 'src/prisma/prisma.service';
import { S3Service } from 'src/prisma/s3.service';
import { AccessTokenPayload } from '@auth/models/auth.model';
import { Prisma, ProductVariant } from '@generated/client';
import { buildSku } from '@shared/helper/sku-generator.helper';
import { generateEan13 } from '@shared/helper/bar-code-generator.helper';

@Injectable()
export class ProductService {

  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
  ) { }


  async createProduct(dto: CreateProductDto) {
    try {
      const product = await this.prisma.product.create({
        data: {
          name: dto.name,
          storeId: dto.storeId,

        }
      })
    } catch (error: any) {
      throw new ForbiddenException(error?.message);
    }
  }

  async createProductVariant(dto: CreateProductVariantDto) {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException("Product not found");

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
  }

  async handleFile(
    files: Express.Multer.File[],
    productId: string,
    storeId: string
  ) {
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
        const fileName = FileHelper.createFileName(file, storeId);

        const url = this.s3Service.uploadFile({
          buffer: buffer,
          fileName: fileName,
          mimetype: file.mimetype
        })

        imgUrlArr.push(url)
      }
      const urls = await Promise.all(imgUrlArr);
      const data = urls.map((url, ind) => {
        return { productId, url, order: ind, isMain: ind === 0 }
      })
      const imgArr = await this.prisma.productImage.createMany({
        data
      })

      return { data, imgArr };
    } catch (error: any) {
      throw new ForbiddenException(error?.message);
    }
  }

  async removeFile(productId: string, body: any, storeId: string) {

  }

  async findAll(documentsToSkip = 0, limitOfDocuments?: number) {
    try {
      const query = this.prisma.product.findMany()
      // if (limitOfDocuments) {
      //   query.limit(limitOfDocuments);
      // }
      // const result = await query.exec();
      // const count = await this.productModel.countDocuments({ isActive: true }).exec();
      return query
    } catch (error: any) {
      throw new ForbiddenException(error?.message);
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

  async findByNameOrBrand(text: string) {
    // const product = await this.productModel.find({
    //   $or: [
    //     {
    //       brand: { '$regex': text, '$options': 'i' }
    //     },
    //     {
    //       name: { '$regex': text, '$options': 'i' }
    //     },
    //   ]
    // }).populate({
    //   path: 'sizes',
    //   populate: {
    //     path: 'colors'
    //   }
    // });
    // return product;
  }

  async updateProduct(id: string, dto: any) {


  }

  async remove(id: string) {
    // const session = await this.connection.startSession();
    // try {
    //   session.startTransaction();
    //   const productId = new Types.ObjectId(id);
    //   await this.productModel.findOneAndUpdate(productId,
    //     {
    //       isActive: false
    //     },
    //     {
    //       session
    //     }
    //   )

    //   await session.commitTransaction();
    //   return true
    // } catch (error:any) {
    //   await session.abortTransaction();

    //   throw new ForbiddenException('Failed to delete product: ' + error?.message);
    // } finally {
    //   await session.endSession();
    // }

  }
}
