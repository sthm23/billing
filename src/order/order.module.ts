import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';

@Module({
  controllers: [OrderController],
  providers: [OrderService],
  // Confirming a Telegram shop request creates the order through it (TelegramModule)
  exports: [OrderService],
})
export class OrderModule {}
