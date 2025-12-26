import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminBootstrap } from './admin.bootstrap';

@Module({
  controllers: [AdminController],
  providers: [AdminService, AdminBootstrap],
})
export class AdminModule { }
