import { BadRequestException, Injectable } from '@nestjs/common';
import {
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
    type S3ClientConfig,
    DeleteObjectCommand,
    PutObjectAclCommandInput,
    DeleteObjectCommandInput,
    CopyObjectCommand,
    CreateBucketCommandInput,
    CreateBucketCommand,
    HeadBucketCommand,
    CreateBucketConfiguration
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { UploadFileType } from '@shared/model/product.model';


@Injectable()
export class S3Service {
    private readonly s3Client: S3Client;
    private readonly bucketName: string;
    private readonly endpointUrl: string;
    private readonly region: string;
    private readonly forcePathStyle: boolean;

    private bucketReady?: Promise<void>;

    constructor(
        private configService: ConfigService
    ) {
        this.bucketName = this.configService.get<string>('AWS_S3_BUCKET_NAME') || '';
        const rawEndpoint = this.configService.get<string>('AWS_S3_ENDPOINT') || '';
        this.endpointUrl =
            rawEndpoint.startsWith('http://') || rawEndpoint.startsWith('https://')
                ? rawEndpoint
                : `http://${rawEndpoint}`;
        this.region = this.configService.get<string>('AWS_REGION') || 'us-east-1';
        this.forcePathStyle = this.configService.get<boolean>('AWS_S3_FORCE_PATH_STYLE') || false;
        const forcePathStyleEnv = this.configService.get<string>('AWS_S3_FORCE_PATH_STYLE');
        if (forcePathStyleEnv != null) {
            this.forcePathStyle = forcePathStyleEnv === 'true';
        } else {
            const host = new URL(this.endpointUrl).hostname;
            this.forcePathStyle = host.includes('localhost') || host.includes('localstack');
        }
        const config: S3ClientConfig = {
            region: this.region,
            endpoint: this.endpointUrl,
            credentials: {
                accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID') || '',
                secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY') || '',
            },
            forcePathStyle: this.forcePathStyle,
        };
        this.s3Client = new S3Client(config)
    }

    private encodeKeyForUrl(key: string): string {
        return key.split('/').map(encodeURIComponent).join('/');
    }
    private getPublicUrl(key: string): string {
        const endpoint = new URL(this.endpointUrl);
        const safeKey = this.encodeKeyForUrl(key);

        if (this.forcePathStyle) {
            return `${endpoint.origin}/${this.bucketName}/${safeKey}`;
        }
        return `${endpoint.protocol}//${this.bucketName}.${endpoint.host}/${safeKey}`;
    }

    private async ensureBucketExists(): Promise<void> {
        if (!this.bucketName) {
            throw new BadRequestException('AWS_S3_BUCKET_NAME is not set');
        }

        this.bucketReady ??= (async () => {
            try {
                await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
                return;
            } catch {
                // not exists / not accessible -> try create
            }

            const input: CreateBucketCommandInput = { Bucket: this.bucketName };
            if (this.region && this.region !== 'us-east-1') {
                input.CreateBucketConfiguration = { LocationConstraint: this.region } as CreateBucketConfiguration;
            }

            await this.s3Client.send(new CreateBucketCommand(input));
        })();

        return this.bucketReady;
    }
    async uploadFile(file: UploadFileType): Promise<string> {
        try {
            await this.ensureBucketExists();

            await this.s3Client.send(
                new PutObjectCommand({
                    Bucket: this.bucketName,
                    Key: file.fileName,
                    Body: file.buffer,
                    ContentType: file.mimetype,
                    ACL: 'public-read',
                }),
            );

            return this.getPublicUrl(file.fileName);
        } catch (error: any) {
            throw new BadRequestException(error?.message ?? 'S3 upload failed');
        }
    }

    async getFile(key: string) {
        await this.ensureBucketExists();
        return this.s3Client.send(
            new GetObjectCommand({
                Bucket: this.bucketName,
                Key: key,
            }),
        );
    }

    async removeFile(key: string) {
        try {
            await this.ensureBucketExists();

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

    async moveToPermanentStorage(tempKey: string, permanentKey: string) {
        try {
            await this.ensureBucketExists();

            const result = await this.s3Client.send(
                new CopyObjectCommand({
                    Bucket: this.bucketName,
                    Key: permanentKey,
                    CopySource: `${this.bucketName}/${tempKey}`,
                    ACL: 'public-read',
                }),
            );

            const deleteResult = await this.s3Client.send(
                new DeleteObjectCommand({
                    Bucket: this.bucketName,
                    Key: tempKey,
                }),
            );
            console.log(result, deleteResult);
            return this.getPublicUrl(permanentKey.split('/').slice(-1)[0]);
        } catch (error: any) {
            throw new BadRequestException(error?.message ?? 'Issue with moving file to permanent storage!');
        }
    }
}