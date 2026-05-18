import { Injectable } from '@nestjs/common';
import { CreateProductImageResponseDto } from './dto/create-file.dto';
import { S3Service } from '@prisma/s3.service';
import { PresignedUrlResult, UploadFileParam } from '@prisma/models/s3.model';
import { FileHelper } from '@shared/helper/file.helper';

@Injectable()
export class FileService {
  constructor(
    private readonly s3Service: S3Service,
  ) { }

  createProductImage(dto: CreateProductImageResponseDto) {
    const arr: Promise<PresignedUrlResult>[] = []
    for (let i = 0; i < dto.files.length; i++) {
      const file = dto.files[i];
      const param = {
        imgName: FileHelper.createFileName(file.fileName),
        mimetype: file.mimeType,
        pathName: 'product',
        storeId: file.storeId
      } as UploadFileParam;

      const url = this.s3Service.uploadFile(param);
      arr.push(url);
    }
    return Promise.all(arr);
  }
}
