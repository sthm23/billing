import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
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