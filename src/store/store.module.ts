import { Module } from '@nestjs/common';
import { StoreService } from './store.service';
import { StoreController } from './store.controller';
import { StoreStaffService } from './store-staff.service';

@Module({
  controllers: [StoreController],
  providers: [StoreService, StoreStaffService],
})
export class StoreModule {}
