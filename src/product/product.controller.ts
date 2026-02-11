import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto, CreateProductVariantDto } from './dto/create-product.dto';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { Roles } from '@shared/decorators/role.decorator';
import { RolesGuard } from '@shared/guards/role.guard';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { PaginationParams } from '@shared/helper/pagination-params.dto';
import { StaffRole, UserRole } from '@generated/enums';
import type { UserAuth } from '@auth/models/auth.model';
import { Staff } from '@generated/client';
@UseGuards(AuthJWTGuard)
@Controller('product')
export class ProductController {
  constructor(private readonly productService: ProductService) { }

  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, StaffRole.MANAGER)
  @Post()
  create(
    @Body() createProductDto: CreateProductDto,
  ) {
    return this.productService.createProduct(createProductDto);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, StaffRole.MANAGER)
  @Post('variants')
  createVariant(
    @Body() dto: CreateProductVariantDto,

  ) {
    return this.productService.createProductVariant(dto);
  }

  @Get()
  findAll(
    @Query() { pageSize, currentPage }: PaginationParams,
    @CurrentUser() user: UserAuth & { staff: Staff }
  ) {
    return this.productService.findAll(pageSize, currentPage, user);
  }

  // @Get('search')
  // search(@Query('text') text: string) {
  //   return this.productService.findByNameOrBrand(text);
  // }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string
  ) {
    return this.productService.findOne(id);
  }
}
