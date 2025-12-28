import { Controller, Get, Post, Body, Patch, Param, Delete, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { AdminGuard } from '@shared/guards/admin.guard';
import { CurrentUser } from '@shared/decorators/user.decorator';
import type { UserWithAuthAndAdmin } from '@auth/models/auth.model';
@UseGuards(AdminGuard, AuthJWTGuard)
@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) { }

  @Post()
  create(
    @CurrentUser() user: UserWithAuthAndAdmin,
    @Body() dto: CreateWarehouseDto
  ) {
    return this.warehouseService.create(dto, user.id);
  }

  @Get()
  findAll() {
    return this.warehouseService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.warehouseService.findOne(id);
  }
}
