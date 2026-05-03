import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import {
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
    type S3ClientConfig,
    DeleteObjectCommand,
    CreateBucketCommandInput,
    CreateBucketCommand,
    HeadBucketCommand,
    CreateBucketConfiguration,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { ConfigService } from '@nestjs/config';
import { PresignedUrlResult, S3KeyParams, UploadFileParam } from './models/s3.model';



@Injectable()
export class S3Service implements OnModuleInit {
    private readonly s3Client: S3Client;
    private readonly bucketName: string;
    private readonly region: string;
    private readonly forcePathStyle: boolean = false;
    private readonly expiresIn = 900; // 15 minutes

    constructor(
        private configService: ConfigService
    ) {
        this.bucketName = this.configService.get<string>('AWS_S3_BUCKET_NAME') || '';

        this.region = this.configService.get<string>('AWS_REGION') || 'eu-west-1';

        const forcePathStyleEnv = this.configService.get<string>('AWS_S3_FORCE_PATH_STYLE');
        if (forcePathStyleEnv != null) {
            this.forcePathStyle = forcePathStyleEnv === 'true';
        }

        const config: S3ClientConfig = {
            region: this.region,
            credentials: {
                accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID') || '',
                secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY') || '',
            },
            forcePathStyle: this.forcePathStyle,
            requestChecksumCalculation: 'WHEN_REQUIRED',
        };
        this.s3Client = new S3Client(config)
    }

    async onModuleInit() {
        await this.ensureBucketExists();
    }


    // private encodeKeyForUrl(key: string): string {
    //     return key.split('/').map(encodeURIComponent).join('/');
    // }
    // private getPublicUrl(key: string): string {
    //     const endpoint = new URL(this.endpointUrl);
    //     const safeKey = this.encodeKeyForUrl(key);

    //     if (this.forcePathStyle) {
    //         return `${endpoint.origin}/${this.bucketName}/${safeKey}`;
    //     }
    //     return `${endpoint.protocol}//${this.bucketName}.${endpoint.host}/${safeKey}`;
    // }

    /* 
    * Generate S3 Key
    * @param storeId - Store ID
    * @param itemId - it should be Product ID user ID etc.
    * @param imgName - Image Name
    * @param pathName - Path Name it can be users,products, img, docs etc.
    * @returns S3 Key
    */
    private generateS3Key(param: S3KeyParams): string {
        const { storeId, imgName, pathName } = param;
        return `${storeId}/${pathName}/img/${imgName}`;
    }

    async uploadFile({ imgName, storeId, pathName, mimetype }: UploadFileParam): Promise<PresignedUrlResult> {
        try {
            const key = this.generateS3Key({
                storeId,
                imgName,
                pathName
            })

            return this.generatePresignedUrl(key, mimetype);
        } catch (error: any) {
            throw new BadRequestException(error?.message ?? 'S3 upload failed');
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
            throw new BadRequestException(error?.message ?? 'Issue with removing file!');
        }
    }

    /**
 * Generates a presigned URL for downloading a file from S3.
 *
 * @param key - key of the file in S3
 * @param filename - optional filename for the downloaded file
 * @returns Promise resolving to presigned URL result
 */
    private async generatePresignedUrl(key: string, contentType: string = 'image/jpeg'): Promise<PresignedUrlResult> {
        try {
            const command = new PutObjectCommand({
                Bucket: this.bucketName,
                Key: key,
                ContentType: contentType,
                // ACL: 'public-read',
            })
            const url = await getSignedUrl(this.s3Client, command, { expiresIn: this.expiresIn })
            return { url, expiresIn: this.expiresIn };
        } catch (error: any) {
            throw new BadRequestException(error?.message ?? 'S3 upload failed');
        }
    }

    private async ensureBucketExists(): Promise<boolean> {
        if (!this.bucketName) {
            throw new BadRequestException('AWS_S3_BUCKET_NAME is not set');
        }
        try {
            await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
            return true;
        } catch (error) {
            console.log(error);

            const result = await this.createBucketCommand();
            if (!result) {
                throw new BadRequestException('Could not create S3 bucket');
            }
            return true;
        }
    }

    private async createBucketCommand() {
        try {
            const input: CreateBucketCommandInput = { Bucket: this.bucketName };
            if (this.region && this.region !== 'us-east-1') {
                input.CreateBucketConfiguration = { LocationConstraint: this.region } as CreateBucketConfiguration;
            }

            await this.s3Client.send(new CreateBucketCommand(input));
            return true
        } catch (error) {
            return false;
        }
    }
}