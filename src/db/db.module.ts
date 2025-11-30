import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { S3Service } from './s3.service';
import { ConfigService } from '@nestjs/config';

@Module({
    providers: [PrismaService, S3Service, ConfigService],
    exports: [PrismaService, S3Service],

})
export class DbModule { }
