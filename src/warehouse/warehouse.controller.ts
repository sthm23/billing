import { Controller, Get, Post, Body, Patch, Param, Delete, ParseUUIDPipe, UseGuards, Query } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { AdminGuard } from '@shared/guards/admin.guard';
import { PaginationParams } from '@shared/helper/pagination-params.dto';
@UseGuards(AuthJWTGuard, AdminGuard)
@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) { }

  @Post()
  create(
    @Body() dto: CreateWarehouseDto
  ) {
    return this.warehouseService.create(dto);
  }

  @Get()
  findAll(@Query() { pageSize, currentPage }: PaginationParams) {
    return this.warehouseService.findAll(pageSize, currentPage);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.warehouseService.findOne(id);
  }
}
