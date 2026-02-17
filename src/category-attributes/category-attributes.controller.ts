import { Controller, Get, Post, Body, Patch, Param, Delete, ParseUUIDPipe, Query } from '@nestjs/common';
import { CategoryAttributesService } from './category-attributes.service';
import { CreateCategoryAttributeDto } from './dto/create-category-attribute.dto';
import { UpdateCategoryAttributeDto } from './dto/update-category-attribute.dto';
import { UserAuth } from '@auth/models/auth.model';
import { Staff } from '@generated/client';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { PaginationParams } from '@shared/helper/pagination-params.dto';

@Controller('category')
export class CategoryAttributesController {
  constructor(private readonly categoryAttributesService: CategoryAttributesService) { }

  @Post()
  createCategory(@Body() createCategoryAttributeDto: CreateCategoryAttributeDto) {
    return this.categoryAttributesService.create(createCategoryAttributeDto);
  }


  @Get('brand')
  findBrands(
    @Query() { pageSize, currentPage }: PaginationParams
  ) {
    return this.categoryAttributesService.findBrands(pageSize, currentPage);
  }

  @Get('brand/:id')
  findStoreBrands(
    @Param('id', new ParseUUIDPipe({ version: '4' })) storeId: string
  ) {
    return this.categoryAttributesService.findStoreBrands(storeId);
  }


  @Get('attributes')
  getAttributes() {
    return this.categoryAttributesService.findAttributes();
  }

  @Get()
  getCategories() {
    return this.categoryAttributesService.findCategories();
  }

  @Get(':id/categories')
  findStoreCategories(
    @Param('id', new ParseUUIDPipe({ version: '4' })) storeId: string
  ) {
    return this.categoryAttributesService.findStoreCategories(storeId);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.categoryAttributesService.findOne(id);
  }


}
