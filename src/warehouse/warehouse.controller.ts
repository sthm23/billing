import { Controller, Get, Post, Body, Patch, Param, Delete, ParseUUIDPipe, UseGuards, Query } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { AddInventoryDto, CreateWarehouseDto } from './dto/create-warehouse.dto';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { AdminGuard } from '@shared/guards/admin.guard';
import { PaginationParams } from '@shared/dto/pagination-params.dto';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { type CurrentUser as CurrentUserType } from '@auth/models/auth.model';
import { StockInDto } from './dto/stock-in.dto';
import { StaffRole, UserRole } from '@generated/client';
import { Roles } from '@shared/decorators/role.decorator';
import { RolesGuard } from '@shared/guards/role.guard';

@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) { }

  @UseGuards(AuthJWTGuard, AdminGuard)
  @Post()
  create(
    @Body() dto: CreateWarehouseDto
  ) {
    return this.warehouseService.createWarehouse(dto);
  }

  @UseGuards(AuthJWTGuard, RolesGuard)
  @Roles(UserRole.OWNER, StaffRole.MANAGER)
  @Post(':id/stock-in')
  stockIn(
    @Param('id', new ParseUUIDPipe({ version: '4' })) warehouseId: string,
    @Body() dto: StockInDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.warehouseService.stockIn(warehouseId, dto, user);
  }

  @UseGuards(AuthJWTGuard, RolesGuard)
  @Roles(UserRole.OWNER, StaffRole.MANAGER)
  @Post(':id/inventory')
  addInventory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) warehouseId: string,
    @Body() dto: AddInventoryDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.warehouseService.addInventory(warehouseId, dto, user);
  }

  @UseGuards(AuthJWTGuard, AdminGuard)
  @Get()
  findAll(@Query() { pageSize, currentPage }: PaginationParams) {
    return this.warehouseService.findAll(pageSize, currentPage);
  }

  @UseGuards(AuthJWTGuard, AdminGuard)
  @Get('/inventory/:id')
  findStockMovement(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.warehouseService.findStockMovement(id);
  }

  @UseGuards(AuthJWTGuard, AdminGuard)
  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.warehouseService.findOne(id);
  }
}
