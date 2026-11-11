import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminStoresController } from './admin-stores.controller';
import { AdminStoresService } from './admin-stores.service';

@Module({
  // AdminStoresController first: `admin/stores` must not be caught by `admin/:id`
  controllers: [AdminStoresController, AdminController],
  providers: [AdminService, AdminStoresService],
})
export class AdminModule {}
