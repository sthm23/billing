import { Controller, Get, Post, Body, Param, UseGuards, ParseUUIDPipe, Query } from '@nestjs/common';
import { StoreService } from './store.service';
import { CreateOwnerDto, CreateStaffDto, CreateStoreDto } from './dto/create-store.dto';
import { CurrentUser } from '@shared/decorators/user.decorator';
import type { CurrentUser as UserInfo, UserAuth } from '@auth/models/auth.model';
import { AdminGuard } from '@shared/guards/admin.guard';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { RolesGuard } from '@shared/guards/role.guard';
import { Roles } from '@shared/decorators/role.decorator';
import { UserRole } from '@generated/enums';
import { PaginationParams } from '@shared/dto/pagination-params.dto';

@UseGuards(AuthJWTGuard, RolesGuard)
@Roles(UserRole.OWNER)
@Controller('store')
export class StoreController {
  constructor(private readonly storeService: StoreService) { }


  @Post()
  createStore(
    @CurrentUser() user: UserAuth,
    @Body() createStoreDto: CreateStoreDto
  ) {
    return this.storeService.createStore(createStoreDto, user.id);
  }

  @UseGuards(AdminGuard)
  @Post('owner')
  createOwner(
    @Body() createStoreDto: CreateOwnerDto
  ) {
    return this.storeService.createOwner(createStoreDto);
  }

  @Post('staff')
  createStaff(
    @Body() createStoreDto: CreateStaffDto
  ) {
    return this.storeService.createStaff(createStoreDto);
  }

  @UseGuards(AdminGuard)
  @Get()
  findAll(
    @Query() { pageSize, currentPage }: PaginationParams,
    @CurrentUser() user: UserInfo
  ) {
    return this.storeService.findAll(pageSize, currentPage, user);
  }

  @Get(':id')
  findStoreById(@Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserInfo) {
    return this.storeService.findStoreById(id, user);
  }

  @Get(':id/stock-movements')
  findStockMovements(@Param('id', ParseUUIDPipe) userId: string) {
    return this.storeService.findStaffStockMovements(userId);
  }
}
