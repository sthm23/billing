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
import { CashboxModule } from './cashbox/cashbox.module';
import { DebtModule } from './debt/debt.module';
import { LoggerModule } from 'nestjs-pino';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport: {
          targets: [
            ...(process.env.NODE_ENV !== 'production'
              ? [{ target: 'pino-pretty', level: 'debug' }]
              : []),
            ...(process.env.LOKI_URL
              ? [{
                  target: 'pino-loki',
                  level: 'info',
                  options: {
                    host: process.env.LOKI_URL,
                    labels: { app: 'billing-api' },
                  },
                }]
              : []),
          ],
        },
      },
    }),
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
    CashboxModule,
    DebtModule,
  ],
  providers: [ConfigService],
})
export class AppModule { }
