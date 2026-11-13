import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  Query,
  Put,
} from '@nestjs/common';
import { StoreService } from './store.service';
import {
  CreateOwnerDto,
  CreateStaffDto,
  CreateStoreDto,
} from './dto/create-store.dto';
import { CurrentUser } from '@shared/decorators/user.decorator';
import type {
  CurrentUser as UserInfo,
  UserAuth,
} from '@auth/models/auth.model';
import { AdminGuard } from '@shared/guards/admin.guard';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { RolesGuard } from '@shared/guards/role.guard';
import { Roles } from '@shared/decorators/role.decorator';
import { UserRole } from '@generated/enums';
import { PaginationParams } from '@shared/dto/pagination-params.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { DateRangeParams } from '@shared/dto/date-range.dto';
import {
  DeactivateStaffDto,
  StaffListParams,
  UpdateStaffDto,
} from './dto/staff.dto';
import { StoreStaffService } from './store-staff.service';

@UseGuards(AuthJWTGuard, RolesGuard)
@Controller('store')
export class StoreController {
  constructor(
    private readonly storeService: StoreService,
    private readonly staffService: StoreStaffService,
  ) {}

  /** Platform ADMIN only (legacy web org-create; mobile uses POST /admin/stores). */
  @Roles(UserRole.OWNER)
  @UseGuards(AdminGuard)
  @Post()
  createStore(
    @CurrentUser() user: UserAuth,
    @Body() createStoreDto: CreateStoreDto,
  ) {
    return this.storeService.createStore(createStoreDto, user.id);
  }

  @Roles(UserRole.OWNER)
  @Put(':id')
  updateStore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStoreDto,
    @CurrentUser() user: UserInfo,
  ) {
    return this.storeService.updateStore(id, dto, user);
  }

  @Roles(UserRole.OWNER)
  @UseGuards(AdminGuard)
  @Post('owner')
  createOwner(@Body() createStoreDto: CreateOwnerDto) {
    return this.storeService.createOwner(createStoreDto);
  }

  @Roles(UserRole.OWNER)
  @Post('staff')
  createStaff(
    @Body() createStoreDto: CreateStaffDto,
    @CurrentUser() user: UserInfo,
  ) {
    return this.storeService.createStaff(createStoreDto, user);
  }

  /** Employees of the owner's store (declared before `:id`). */
  @Roles(UserRole.OWNER)
  @Get('staff')
  listStaff(@Query() params: StaffListParams, @CurrentUser() user: UserInfo) {
    return this.staffService.list(params, user);
  }

  /** Employee card; `from`/`to` — period of the sales stats (default: this month). */
  @Roles(UserRole.OWNER)
  @Get('staff/:staffId')
  findStaff(
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Query() range: DateRangeParams,
    @CurrentUser() user: UserInfo,
  ) {
    return this.staffService.findOne(staffId, range, user);
  }

  @Roles(UserRole.OWNER)
  @Put('staff/:staffId')
  updateStaff(
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() dto: UpdateStaffDto,
    @CurrentUser() user: UserInfo,
  ) {
    return this.staffService.update(staffId, dto, user);
  }

  @Roles(UserRole.OWNER)
  @Post('staff/:staffId/deactivate')
  deactivateStaff(
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() dto: DeactivateStaffDto,
    @CurrentUser() user: UserInfo,
  ) {
    return this.staffService.deactivate(staffId, dto, user);
  }

  @Roles(UserRole.OWNER)
  @Post('staff/:staffId/activate')
  activateStaff(
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @CurrentUser() user: UserInfo,
  ) {
    return this.staffService.activate(staffId, user);
  }

  @Roles(UserRole.OWNER)
  @UseGuards(AdminGuard)
  @Get()
  findAll(
    @Query() { pageSize, currentPage }: PaginationParams,
    @CurrentUser() user: UserInfo,
  ) {
    return this.storeService.findAll(pageSize, currentPage, user);
  }

  @Roles(UserRole.OWNER)
  @Get(':id')
  findStoreById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserInfo,
  ) {
    return this.storeService.findStoreById(id, user);
  }

  @Get(':id/stock-movements')
  findStockMovements(
    @Param('id', ParseUUIDPipe) userId: string,
    @CurrentUser() user: UserInfo,
  ) {
    return this.storeService.findStaffStockMovements(userId, user);
  }
}
