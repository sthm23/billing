import { Controller, Get, Post, Body, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CategoryAttributesService } from './category-attributes.service';
import { CreateCategoryAttributeDto } from './dto/create-category-attribute.dto';
import { PaginationParams } from '@shared/helper/pagination-params.dto';

@Controller('category')
export class CategoryAttributesController {
  constructor(private readonly categoryAttributesService: CategoryAttributesService) { }

  @Post()
  createCategory(@Body() createCategoryAttributeDto: CreateCategoryAttributeDto) {
    return this.categoryAttributesService.create(createCategoryAttributeDto);
  }


  @Get('brand')
  findBrands() {
    return this.categoryAttributesService.findBrands();
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

  @Get('attributes/store/:id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) storeId: string) {
    return this.categoryAttributesService.findStoreAttributes(storeId);
  }

  @Get('attributes/:id')
  getAttributeItem(
    @Param('id', new ParseUUIDPipe({ version: '4' })) attrId: string
  ) {
    return this.categoryAttributesService.findAttributeItem(attrId);
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
}
