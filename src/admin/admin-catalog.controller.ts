import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { AdminGuard } from '@shared/guards/admin.guard';
import { AdminCatalogService } from './admin-catalog.service';
import { CatalogSearchParams } from './dto/admin-catalog.dto';

/** Global brand / attribute dictionaries for the store catalog editor — platform ADMIN only */
@UseGuards(AuthJWTGuard, AdminGuard)
@UsePipes(new ValidationPipe({ transform: true }))
@Controller('admin/catalog')
export class AdminCatalogController {
  constructor(private readonly catalogService: AdminCatalogService) {}

  /** Most connected first; `storeCount` = stores using the brand */
  @Get('brands')
  searchBrands(@Query() params: CatalogSearchParams) {
    return this.catalogService.searchBrands(params);
  }

  /** Search by ru / uz / en name; `storeCount` = stores using the attribute */
  @Get('attributes')
  searchAttributes(@Query() params: CatalogSearchParams) {
    return this.catalogService.searchAttributes(params);
  }
}
