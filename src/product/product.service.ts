import { ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { FileHelper } from '@shared/helper/file.helper';
import { ProductSold } from '@shared/model/product.model';
import { PrismaService } from 'src/prisma/prisma.service';
import { S3Service } from 'src/prisma/s3.service';
import { AccessTokenPayload } from '@auth/models/auth.model';
import { ProductVariant } from '@generated/client';

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

  async createProductVariant(dto: ProductVariant[]) {
    await this.prisma.$transaction(async tx => {
      // const product = await tx.product.create({ ... })

      // await tx.productImage.createMany({ ... })

      // await tx.productVariant.createMany({ ... })

      // await tx.productAttributeValue.createMany({ ... })
    })
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
