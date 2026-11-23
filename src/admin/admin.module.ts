import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminStoresController } from './admin-stores.controller';
import { AdminStoresService } from './admin-stores.service';
import { OrderAssistantModule } from '../order-assistant/order-assistant.module';

@Module({
  imports: [OrderAssistantModule],
  // AdminStoresController first: `admin/stores` must not be caught by `admin/:id`
  controllers: [AdminStoresController, AdminController],
  providers: [AdminService, AdminStoresService],
})
export class AdminModule {}
