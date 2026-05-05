import { Controller, Get, Post, Body, Patch, Param, Delete, ParseUUIDPipe, UseGuards, Query } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { AdminGuard } from '@shared/guards/admin.guard';
import { PaginationParams } from '@shared/dto/pagination-params.dto';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { type CurrentUser as CurrentUserType } from '@auth/models/auth.model';
import { StockInDto } from './dto/stock-in.dto';

@UseGuards(AuthJWTGuard, AdminGuard)
@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) { }

  @Post()
  create(
    @Body() dto: CreateWarehouseDto
  ) {
    return this.warehouseService.createWarehouse(dto);
  }

  @Post(':id/stock-in')
  stockIn(
    @Param('id', new ParseUUIDPipe({ version: '4' })) warehouseId: string,
    @Body() dto: StockInDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.warehouseService.stockIn(warehouseId, dto, user);
  }

  @Get()
  findAll(@Query() { pageSize, currentPage }: PaginationParams) {
    return this.warehouseService.findAll(pageSize, currentPage);
  }

  @Get('/inventory/:id')
  findStockMovement(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.warehouseService.findStockMovement(id);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.warehouseService.findOne(id);
  }
}
