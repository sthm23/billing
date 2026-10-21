import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
  ParseUUIDPipe,
  Delete,
  Put,
} from '@nestjs/common';
import { ProductService } from './product.service';
import {
  CreateProductDto,
  CreateProductVariantDto,
} from './dto/create-product.dto';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { Roles } from '@shared/decorators/role.decorator';
import { RolesGuard } from '@shared/guards/role.guard';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { PaginationParams } from '@shared/dto/pagination-params.dto';
import { StaffRole, UserRole } from '@generated/enums';
import { type CurrentUser as CurrentUserType } from '@auth/models/auth.model';
import { UpdateProductVariantPriceDTO } from './dto/update-product.dto';
import { ProductListParams } from './dto/product-list-params.dto';

@UseGuards(AuthJWTGuard)
@Controller('product')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, StaffRole.MANAGER)
  @Post()
  create(
    @Body() createProductDto: CreateProductDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.productService.createProduct(createProductDto, user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, StaffRole.MANAGER)
  @Post('variants')
  createVariant(
    @Body() dto: CreateProductVariantDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.productService.createProductVariant(dto, user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, StaffRole.MANAGER)
  @Put('variants/:id')
  updateVariant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductVariantPriceDTO,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.productService.updateProductVariant(id, dto, user);
  }

  @Get('search/:id')
  search(
    @Query() { pageSize, currentPage }: PaginationParams,
    @Query('text') text: string,
    @Param('id', ParseUUIDPipe) warehouseId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.productService.search(
      pageSize,
      currentPage,
      text,
      warehouseId,
      user,
    );
  }

  @Get('variants')
  findAllVariants(
    @Query() { pageSize, currentPage }: PaginationParams,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.productService.findAllVariants(pageSize, currentPage, user);
  }

  @Get('variants/:id/stock-movements')
  findStockMovements(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() { pageSize, currentPage }: PaginationParams,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.productService.findStockMovements(
      id,
      pageSize,
      currentPage,
      user,
    );
  }

  @Get()
  findAll(
    @Query() params: ProductListParams,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.productService.findAll(params, user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.productService.findOne(id, user);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, StaffRole.MANAGER)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.productService.remove(id, user);
  }
}
