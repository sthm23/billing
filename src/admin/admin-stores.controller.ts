import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import type { CurrentUser as UserInfo } from '@auth/models/auth.model';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { AdminGuard } from '@shared/guards/admin.guard';
import { AdminStoresService } from './admin-stores.service';
import { AdminCatalogService } from './admin-catalog.service';
import {
  ConnectStoreAttributeDto,
  ConnectStoreBrandDto,
} from './dto/admin-catalog.dto';
import {
  AdminStoreListParams,
  CreateAdminStoreDto,
  ResumeStoreDto,
  SuspendStoreDto,
  UpdateAdminStoreDto,
} from './dto/admin-store.dto';

/** Store administration — platform ADMIN only (mobile: Profile → «Магазины»). */
@UseGuards(AuthJWTGuard, AdminGuard)
// The global ValidationPipe has no `transform`: without it query numbers stay
// strings (Prisma `take: "10"`) and the DTO @Transform (trim, digits) is lost.
@UsePipes(new ValidationPipe({ transform: true }))
@Controller('admin/stores')
export class AdminStoresController {
  constructor(
    private readonly storesService: AdminStoresService,
    private readonly catalogService: AdminCatalogService,
  ) {}

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
    @CurrentUser() admin: UserInfo,
  ) {
    return this.storesService.update(id, dto, admin);
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

  /** Connect a brand: by id, or by name (found or created) */
  @Post(':id/brands')
  connectBrand(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConnectStoreBrandDto,
    @CurrentUser() admin: UserInfo,
  ) {
    return this.catalogService.connectBrand(id, dto, admin);
  }

  /** 409 IN_USE when the store's products (archived included) use it */
  @Delete(':id/brands/:brandId')
  disconnectBrand(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @CurrentUser() admin: UserInfo,
  ) {
    return this.catalogService.disconnectBrand(id, brandId, admin);
  }

  /** Connect an attribute: by id, or a new one (409 ATTRIBUTE_EXISTS if the name is taken) */
  @Post(':id/attributes')
  connectAttribute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConnectStoreAttributeDto,
    @CurrentUser() admin: UserInfo,
  ) {
    return this.catalogService.connectAttribute(id, dto, admin);
  }

  /** 409 IN_USE when the store's products (archived included) use it */
  @Delete(':id/attributes/:attributeId')
  disconnectAttribute(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attributeId', ParseUUIDPipe) attributeId: string,
    @CurrentUser() admin: UserInfo,
  ) {
    return this.catalogService.disconnectAttribute(id, attributeId, admin);
  }
}
