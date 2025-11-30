import { AuthModule } from '@auth/auth.module';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { UserModule } from '@user/user.module';
import { SuperUserService } from './super-user/super-user.service';
import { ProductModule } from './product/product.module';
import { DbModule } from './db/db.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MulterModule.register({ dest: './uploads' }),
    DbModule,
    UserModule,
    AuthModule,
    ProductModule,
  ],
  providers: [SuperUserService, ConfigService],
})
export class AppModule { }
