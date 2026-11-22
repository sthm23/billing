import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import { PresignedUrlResult, S3ObjectInfo } from './models/s3.model';

/**
 * S3-compatible object storage (Uztelecom Object Storage in prod, path-style).
 * The bucket is created by hand in the provider panel; the API never creates it.
 */
@Injectable()
export class S3Service {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly expiresIn = 600; // 10 minutes

  constructor(private configService: ConfigService) {
    this.bucketName =
      this.configService.get<string>('AWS_S3_BUCKET_NAME') || '';
    const endpoint = this.configService.get<string>('S3_ENDPOINT');

    const config: S3ClientConfig = {
      region: this.configService.get<string>('AWS_REGION') || 'us-east-1',
      ...(endpoint ? { endpoint } : {}),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID') || '',
        secretAccessKey:
          this.configService.get<string>('AWS_SECRET_ACCESS_KEY') || '',
      },
      forcePathStyle:
        this.configService.get<string>('AWS_S3_FORCE_PATH_STYLE') === 'true',
      // S3-compatible storages reject the SDK's default CRC32 checksum headers
      requestChecksumCalculation: 'WHEN_REQUIRED',
    };
    this.s3Client = new S3Client(config);
  }

  /**
   * Presigned PUT URL. Content-Type and Content-Length are signed: the client must send
   * exactly this type and this many bytes, otherwise the storage rejects the upload.
   */
  async createUploadUrl(
    key: string,
    contentType: string,
    contentLength: number,
  ): Promise<PresignedUrlResult> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      });
      const url = await getSignedUrl(this.s3Client, command, {
        expiresIn: this.expiresIn,
        signableHeaders: new Set(['content-type', 'content-length']),
      });
      return { url, key, expiresIn: this.expiresIn };
    } catch (error: any) {
      throw new BadRequestException(error?.message ?? 'S3 upload failed');
    }
  }

  /** Size and type of an uploaded object, or null when it does not exist. */
  async headObject(key: string): Promise<S3ObjectInfo | null> {
    try {
      const res = await this.s3Client.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
      return {
        size: res.ContentLength ?? 0,
        contentType: res.ContentType ?? '',
      };
    } catch (error: any) {
      const status = error?.$metadata?.httpStatusCode;
      if (
        status === 404 ||
        error?.name === 'NotFound' ||
        error?.name === 'NoSuchKey'
      )
        return null;
      throw error;
    }
  }

  async getFile(key: string) {
    return this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }),
    );
  }

  async removeFile(key: string) {
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );

      return { message: 'Image successfully removed' };
    } catch (error: any) {
      throw new BadRequestException(
        error?.message ?? 'Issue with removing file!',
      );
    }
  }
}
