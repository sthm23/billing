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
  create(@Body() createCategoryAttributeDto: CreateCategoryAttributeDto) {
    return this.categoryAttributesService.create(createCategoryAttributeDto);
  }

  @Get()
  getCategories(
    @Query('storeId') storeId?: string,
  ) {
    return this.categoryAttributesService.findCategories(storeId);
  }


  @Get('tree')
  findTree() {
    return this.categoryAttributesService.findTRee();
  }

  @Get('brand')
  findBrands(
    @Query() { pageSize, currentPage }: PaginationParams
  ) {
    return this.categoryAttributesService.findBrands(pageSize, currentPage);
  }


  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.categoryAttributesService.findOne(id);
  }


}
