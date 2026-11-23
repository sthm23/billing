import { Module } from '@nestjs/common';
import { StoreService } from './store.service';
import { StoreController } from './store.controller';
import { StoreStaffService } from './store-staff.service';
import { OrderAssistantModule } from '../order-assistant/order-assistant.module';

@Module({
  imports: [OrderAssistantModule],
  controllers: [StoreController],
  providers: [StoreService, StoreStaffService],
})
export class StoreModule {}
