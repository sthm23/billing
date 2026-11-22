import { ForbiddenException, Injectable } from '@nestjs/common';
import { CreateProductImageResponseDto } from './dto/create-file.dto';
import { S3Service } from '@prisma/s3.service';
import { PresignedUrlResult } from '@prisma/models/s3.model';
import { FileHelper } from '@shared/helper/file.helper';
import { CurrentUser } from '@auth/models/auth.model';

@Injectable()
export class FileService {
  constructor(private readonly s3Service: S3Service) {}

  /** Presigned PUT URLs under `products/<storeId>/`; the store is taken from the token, never from the body. */
  createProductImage(
    dto: CreateProductImageResponseDto,
    user: CurrentUser,
  ): Promise<PresignedUrlResult[]> {
    const storeId = user.staff?.storeId;
    if (!storeId)
      throw new ForbiddenException(
        'Only store staff can upload product images',
      );

    const prefix = FileHelper.productImagePrefix(storeId);
    return Promise.all(
      dto.files.map((file) =>
        this.s3Service.createUploadUrl(
          `${prefix}${FileHelper.createFileName(file.mimeType)}`,
          file.mimeType,
          file.fileSize,
        ),
      ),
    );
  }
}
