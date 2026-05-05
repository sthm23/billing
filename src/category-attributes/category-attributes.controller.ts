import { Controller, Get, Post, Body, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CategoryAttributesService } from './category-attributes.service';
import { CreateAttributeDto, CreateAttributeValueDto } from './dto/create-category-attribute.dto';
import { PaginationParams } from '@shared/dto/pagination-params.dto';
import { IdParamDto } from '@shared/dto/id-param.dto';

@Controller('category')
export class CategoryAttributesController {
  constructor(private readonly categoryAttributesService: CategoryAttributesService) { }


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

  @Get('tag')
  findTags() {
    return this.categoryAttributesService.findTags();
  }


  @Get('attributes')
  getAttributes() {
    return this.categoryAttributesService.findAttributes();
  }

  @Get('attributes/store/:id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) storeId: string) {
    return this.categoryAttributesService.findStoreAttributes(storeId);
  }


  @Get('attributes/items')
  getAttributeItems(
    @Query() { attributeIds }: IdParamDto
  ) {
    const idArray = attributeIds.split(',');
    return this.categoryAttributesService.getAttributeItems(idArray);
  }

  @Get('attributes/:id')
  getAttributeItem(
    @Param('id', new ParseUUIDPipe({ version: '4' })) attrId: string
  ) {
    return this.categoryAttributesService.findAttributeItem(attrId);
  }

  @Post('attribute')
  createAttribute(@Body() createCategoryAttributeDto: CreateAttributeDto) {
    return this.categoryAttributesService.createAttribute(createCategoryAttributeDto);
  }

  @Post('attribute/value')
  createAttributeValue(@Body() createCategoryAttributeDto: CreateAttributeValueDto) {
    return this.categoryAttributesService.createAttributeValue(createCategoryAttributeDto);
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
