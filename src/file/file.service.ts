import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateProductImageDto, CreateProductImageResponseDto } from './dto/create-file.dto';
import { PrismaService } from '@prisma/prisma.service';
import { S3Service } from '@prisma/s3.service';
import { PresignedUrlResult, UploadFileParam } from '@prisma/models/s3.model';

@Injectable()
export class FileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) { }

  createProductImage(dto: CreateProductImageResponseDto) {

    const arr: Promise<PresignedUrlResult>[] = []
    for (let i = 0; i < dto.files.length; i++) {
      const file = dto.files[i];
      const param = {
        imgName: file.fileName,
        mimetype: file.mimeType,
        pathName: 'product',
        storeId: file.storeId
      } as UploadFileParam;

      const url = this.s3Service.uploadFile(param);
      arr.push(url);
    }
    return Promise.all(arr);
  }


  // async handleFile(files: UploadFileParam[]): Promise<string[]> {
  //   try {
  //     for (const file of files) {
  //       const fileName = FileHelper.generateFileName(file.imgName);
  //     }

  //     const url = this.s3Service.uploadFile({
  //       fileName: fileName,
  //       mimetype: file.mimetype
  //     })

  //     imgUrlArr.push(url)

  //     return Promise.all(imgUrlArr);

  //   } catch (error: any) {
  //     throw new BadRequestException(error.response || error.message)
  //   }
  // }

  findAll() {
    return `This action returns all file`;
  }

  findOne(id: number) {
    return `This action returns a #${id} file`;
  }


  remove(id: number) {
    return `This action removes a #${id} file`;
  }
}
