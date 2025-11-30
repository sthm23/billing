import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

export const fileUploadInterceptor = FilesInterceptor('photo', 4, {
  storage: memoryStorage(),
  limits: {
    fileSize: 7 * 1024 * 1024, // 7MB
  },
});