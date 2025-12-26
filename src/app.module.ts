import { AuthModule } from '@auth/auth.module';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { UserModule } from '@user/user.module';
import { SuperUserService } from './super-user/super-user.service';
import { ProductModule } from './product/product.module';
import { DbModule } from './db/db.module';
import { AdminModule } from './admin/admin.module';
import { SellerModule } from './seller/seller.module';
import { WarehouseModule } from './warehouse/warehouse.module';
import { OrderModule } from './order/order.module';
import { PaymentModule } from './payment/payment.module';
import { ReportModule } from './report/report.module';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MulterModule.register({ dest: './uploads' }),
    DbModule,
    AdminModule,
    SellerModule,
    WarehouseModule,
    OrderModule,
    PaymentModule,
    ReportModule,
    SharedModule,
    // UserModule,
    // AuthModule,
    // ProductModule,
  ],
  providers: [SuperUserService, ConfigService],
})
export class AppModule { }
