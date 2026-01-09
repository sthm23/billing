import { BadRequestException, Injectable } from '@nestjs/common';
import {
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
    type S3ClientConfig,
    DeleteObjectCommand
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';


@Injectable()
export class S3Service {
    private s3Client: S3Client;

    constructor(
        private configService: ConfigService
    ) {
        const config: S3ClientConfig = {
            region: this.configService.get('AWS_REGION'),
            endpoint: `http://${this.configService.get('AWS_S3_ENDPOINT')}`,
            credentials: {
                accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID') || '',
                secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY') || '',
            },
            forcePathStyle: false,
            // forcePathStyle: true,
            // endpoint: "http://localhost:4566",
        }
        this.s3Client = new S3Client(config)

    }

    async uploadFile(
        // file: Express.Multer.File, 
        // fileName: string
        file: { buffer: Buffer<ArrayBufferLike>, mimetype: string, fileName: string },
    ): Promise<string> {
        try {
            const bucketName = this.configService.get<string>('AWS_S3_BUCKET_NAME')
            const endpoint = this.configService.get<string>('AWS_S3_ENDPOINT')
            const params = new PutObjectCommand({
                Bucket: bucketName || '',
                Key: file.fileName,
                Body: file.buffer,
                ContentType: file.mimetype,
                ACL: 'public-read', // Or adjust as needed for your use case
            });
            const uploadResult = await this.s3Client.send(params);

            return `http://${bucketName}.${endpoint}/${file.fileName}`; // Returns the URL of the uploaded file
        } catch (error: any) {
            throw new BadRequestException(error.message);
        }
    }

    async getFile(key: string) {
        const params = new GetObjectCommand({
            Bucket: this.configService.get<string>('AWS_S3_BUCKET_NAME') || '',
            Key: key
        })
        const file = await this.s3Client.send(params);

        return file;
    }

    async removeFile(key: string) {
        try {
            const params = new DeleteObjectCommand({
                Bucket: this.configService.get<string>('AWS_S3_BUCKET_NAME') || '',
                Key: key
            });
            await this.s3Client.send(params);
            return { message: 'Image successfully removed' }
        } catch (error) {
            throw new BadRequestException('Issue with removing file!')
        }
    }

}