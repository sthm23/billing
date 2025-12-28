import { ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { FileHelper } from '@shared/helper/file.helper';
import { ProductSold } from '@shared/model/product.model';
import { PrismaService } from 'src/prisma/prisma.service';
import { S3Service } from 'src/prisma/s3.service';
import { AccessTokenPayload } from '@auth/models/auth.model';

@Injectable()
export class ProductService {

  constructor(
    private prismaClient: PrismaService,
    private s3Service: S3Service,
  ) { }


  async createProduct({ sizes, ...createProductDto }: any, payload: AccessTokenPayload) {
    // const session = await this.connection.startSession();
    // session.startTransaction();
    // try {
    //   const productModel = new this.productModel(createProductDto);

    //   const id = productModel._id.toString();
    //   const productId = new Types.ObjectId(id);
    //   const userId = new Types.ObjectId(payload.userId);

    //   if (sizes && sizes.length) {
    //     const {
    //       quantity,
    //       productSizeIds
    //     } = await this.workWithProductSizes({ sizes, productId, userId }, session);
    //     productModel.sizes.push(...productSizeIds);
    //     productModel.quantity = quantity;
    //   }

    //   const newProduct = await productModel.save({ session });
    //   await session.commitTransaction();
    //   return newProduct;
    // } catch (error:any) {
    //   await session.abortTransaction();
    //   throw new ForbiddenException(error?.message);
    // } finally {
    //   await session.endSession();
    // }
  }


  async findAll(documentsToSkip = 0, limitOfDocuments?: number) {
    try {
      const query = this.prismaClient.product.findMany()
      // if (limitOfDocuments) {
      //   query.limit(limitOfDocuments);
      // }
      // const result = await query.exec();
      // const count = await this.productModel.countDocuments({ isActive: true }).exec();
      // return {
      return query
    } catch (error: any) {
      throw new ForbiddenException(error?.message);
    }
  }

  async findOne(id: string, dto?: any) {
    // const populateOptions = this.makePopulateOptions(dto);
    // try {
    //   const product = await this.productModel.findById(id)
    //     .populate<{ sizes: ProductSize }>(populateOptions)
    //     .exec();
    //   if (!product) throw new NotFoundException('Product not found');
    //   return product;
    // } catch (error:any) {
    //   throw new ForbiddenException('Product not found: ' + error?.message);
    // }
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

  async updateProduct(id: string, { sizes, ...dto }: any) {

    // const session = await this.connection.startSession();

    // try {
    //   session.startTransaction();

    //   // Обновляем продукт
    //   await this.productModel.findByIdAndUpdate(id, dto, { session });

    //   // Обновляем или создаем варианты
    //   for (const size of sizes || []) {
    //     if (size._id) {
    //       // Если _id есть, обновляем существующий вариант
    //       const updsize = await this.productSizeModel.updateOne(
    //         { _id: new Types.ObjectId(size._id) },
    //         { $set: size },
    //         { session }
    //       );
    //     } else {
    //       // Если _id нет, создаем новый вариант
    //       const newSize = await new this.productSizeModel(size).save({ session });
    //     }
    //   }

    //   await session.commitTransaction();

    //   return this.findOne(id);
    // } catch (error:any) {
    //   await session.abortTransaction();
    //   throw new ForbiddenException('Product updating error: ' + error?.message);
    // } finally {
    //   await session.endSession();
    // }
  }

  // async updateProductSize(id: string, sizes: UpdateProductSizeDTO) {
  //   try {
  //     const productId = new Types.ObjectId(id);
  //     const productsizes = await this.productSizeModel.find({
  //       productId
  //     }).exec();
  //     return productsizes
  //   } catch (error:any) {
  //     throw new ForbiddenException('Product sizes updating error: ' + error?.message);
  //   }
  // }

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

  async productSold(dto: ProductSold) {

    // try {
    //   const productColor = await this.productColorModel.findByIdAndUpdate(dto.colorId, {
    //     $inc: {
    //       sold: dto.quantity,
    //       stock: -dto.quantity
    //     }
    //   }, { new: true, session }).exec();

    //   const productSize = await this.productSizeModel.findByIdAndUpdate(dto.sizeId, {
    //     $inc: {
    //       quantity: -dto.quantity
    //     }
    //   }, { new: true, session }).exec();

    //   const product = await this.productModel.findByIdAndUpdate(dto.productId, {
    //     $inc: {
    //       quantity: -dto.quantity
    //     }
    //   }, { new: true, session }).exec();

    //   return Promise.all([productColor, productSize, product]);

    // } catch (error:any) {
    //   throw new Error(`Error selling product: ${error.message}`);
    // }
  }



  async handleFile(files: Express.Multer.File[]) {
    try {
      const compressedPhotos = await Promise.all(
        files.map(async (file) => {
          const url = this.s3Service.uploadFile(file, file.originalname)
          // const fileName = FileHelper.createFileName(file);
          // const originalBuffer = await FileHelper.compressImage(file); // Читаем файл в память
          // FileHelper.writeFile(fileName, originalBuffer);
          return url // Возвращаем ссылку
        })
      );
      return compressedPhotos
    } catch (error: any) {
      throw new ForbiddenException(error?.message);
    }
  }
}
