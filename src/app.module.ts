import { AuthModule } from '@auth/auth.module';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserModule } from '@user/user.module';
import { ProductModule } from './product/product.module';
import { AdminModule } from './admin/admin.module';
import { WarehouseModule } from './warehouse/warehouse.module';
import { OrderModule } from './order/order.module';
import { PaymentModule } from './payment/payment.module';
import { SharedModule } from './shared/shared.module';
import { PrismaModule } from './prisma/prisma.module';
import { StoreModule } from './store/store.module';
import { CategoryAttributesModule } from './category-attributes/category-attributes.module';
import { FileModule } from './file/file.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AdminModule,
    UserModule,
    AuthModule,
    ProductModule,
    WarehouseModule,
    OrderModule,
    PaymentModule,
    SharedModule,
    StoreModule,
    CategoryAttributesModule,
    FileModule,
  ],
  providers: [ConfigService],
})
export class AppModule { }
