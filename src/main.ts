import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  // req.ip = real client IP behind a reverse proxy on the same host (nginx);
  // X-Forwarded-For from anyone else is ignored. Used by the login rate limit.
  app.set('trust proxy', 'loopback');
  app.useLogger(app.get(Logger));
  const configService = app.get(ConfigService);
  // Включаем глобальную валидацию
  app.useGlobalPipes(
    new ValidationPipe(),
  );

  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.use(cookieParser());
  app.setGlobalPrefix('api')
  await app.listen(configService.get('PORT') ?? 3000);
}
bootstrap();