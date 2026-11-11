import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import type { CurrentUser as UserInfo } from '@auth/models/auth.model';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { AdminGuard } from '@shared/guards/admin.guard';
import { AdminStoresService } from './admin-stores.service';
import {
  AdminStoreListParams,
  CreateAdminStoreDto,
  ResumeStoreDto,
  SuspendStoreDto,
  UpdateAdminStoreDto,
} from './dto/admin-store.dto';

/** Store administration — platform ADMIN only (mobile: Profile → «Магазины»). */
@UseGuards(AuthJWTGuard, AdminGuard)
@Controller('admin/stores')
export class AdminStoresController {
  constructor(private readonly storesService: AdminStoresService) {}

  @Get()
  list(@Query() params: AdminStoreListParams) {
    return this.storesService.list(params);
  }

  @Post()
  create(@Body() dto: CreateAdminStoreDto, @CurrentUser() admin: UserInfo) {
    return this.storesService.create(dto, admin);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.storesService.findOne(id);
  }

  @Get(':id/staff')
  listStaff(@Param('id', ParseUUIDPipe) id: string) {
    return this.storesService.listStaff(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminStoreDto,
  ) {
    return this.storesService.update(id, dto);
  }

  @Post(':id/suspend')
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendStoreDto,
    @CurrentUser() admin: UserInfo,
  ) {
    return this.storesService.suspend(id, dto, admin);
  }

  @Post(':id/resume')
  resume(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResumeStoreDto,
    @CurrentUser() admin: UserInfo,
  ) {
    return this.storesService.resume(id, dto, admin);
  }
}
