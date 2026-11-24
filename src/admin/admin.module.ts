import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminStoresController } from './admin-stores.controller';
import { AdminStoresService } from './admin-stores.service';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminCatalogService } from './admin-catalog.service';
import { OrderAssistantModule } from '../order-assistant/order-assistant.module';

@Module({
  imports: [OrderAssistantModule],
  // AdminStoresController / AdminCatalogController first: `admin/stores`, `admin/catalog`
  // must not be caught by `admin/:id`
  controllers: [AdminStoresController, AdminCatalogController, AdminController],
  providers: [AdminService, AdminStoresService, AdminCatalogService],
})
export class AdminModule {}
