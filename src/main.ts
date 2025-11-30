import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';
import { join } from 'path';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  // Включаем глобальную валидацию
  app.useGlobalPipes(
    new ValidationPipe(),
  );

  app.use('/static', express.static(join(__dirname, '..', 'uploads')));
  app.enableCors({
    origin: true
  });
  app.setGlobalPrefix('api')

  await app.listen(configService.get('PORT') ?? 3000);
}
bootstrap();