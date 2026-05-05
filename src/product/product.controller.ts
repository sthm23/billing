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
} from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto, CreateProductVariantDto } from './dto/create-product.dto';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { Roles } from '@shared/decorators/role.decorator';
import { RolesGuard } from '@shared/guards/role.guard';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { PaginationParams } from '@shared/dto/pagination-params.dto';
import { StaffRole, UserRole } from '@generated/enums';
import { type CurrentUser as CurrentUserType } from '@auth/models/auth.model';
@UseGuards(AuthJWTGuard)
@Controller('product')
export class ProductController {
  constructor(private readonly productService: ProductService) { }

  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, StaffRole.MANAGER)
  @Post()
  create(
    @Body() createProductDto: CreateProductDto,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.productService.createProduct(createProductDto, user);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, StaffRole.MANAGER)
  @Post('variants')
  createVariant(
    @Body() dto: CreateProductVariantDto,
    @CurrentUser() user: CurrentUserType

  ) {
    return this.productService.createProductVariant(dto, user);
  }

  @Get('search/:id')
  search(
    @Query() { pageSize, currentPage }: PaginationParams,
    @Query('text') text: string,
    @Param('id', ParseUUIDPipe) warehouseId: string,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.productService.search(pageSize, currentPage, text, warehouseId, user);
  }

  @Get('variants')
  findAllVariants(
    @Query() { pageSize, currentPage }: PaginationParams,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.productService.findAllVariants(pageSize, currentPage, user);
  }

  @Get()
  findAll(
    @Query() { pageSize, currentPage }: PaginationParams,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.productService.findAll(pageSize, currentPage, user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string
  ) {
    return this.productService.findOne(id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, StaffRole.MANAGER)
  remove(
    @Param('id', ParseUUIDPipe) id: string
  ) {
    return this.productService.remove(id);
  }
}
