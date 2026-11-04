import { Controller, Get, Post, Body, Param, ParseUUIDPipe, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { CategoryAttributesService } from './category-attributes.service';
import { CreateAttributeDto, CreateAttributeValueDto } from './dto/create-category-attribute.dto';
import { PaginationParams } from '@shared/dto/pagination-params.dto';
import { IdParamDto } from '@shared/dto/id-param.dto';
import { AttributeParams } from './dto/attribute-params.dto';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { AdminGuard } from '@shared/guards/admin.guard';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { type CurrentUser as CurrentUserType } from '@auth/models/auth.model';
import { UserRole } from '@generated/enums';

@UseGuards(AuthJWTGuard)
@Controller('category')
export class CategoryAttributesController {
  constructor(private readonly categoryAttributesService: CategoryAttributesService) { }

  /** The store in the URL must be the user's own (admin: any). */
  private ownStore(storeId: string, user: CurrentUserType) {
    if (user.role !== UserRole.ADMIN && user.staff?.storeId !== storeId) {
      throw new ForbiddenException('No access to this store');
    }
    return storeId;
  }


  @Get('brand')
  findBrands() {
    return this.categoryAttributesService.findBrands();
  }

  @Get('brand/:id')
  findStoreBrands(
    @Param('id', new ParseUUIDPipe({ version: '4' })) storeId: string,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.categoryAttributesService.findStoreBrands(this.ownStore(storeId, user));
  }

  @Get('tag')
  findTags() {
    return this.categoryAttributesService.findTags();
  }


  @Get('attributes')
  getAttributes(
    @Query() pagination: AttributeParams
  ) {
    return this.categoryAttributesService.findAttributes(pagination);
  }

  @Get('attributes/store/:id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) storeId: string,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.categoryAttributesService.findStoreAttributes(this.ownStore(storeId, user));
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

  @UseGuards(AdminGuard)
  @Post('attribute')
  createAttribute(@Body() createCategoryAttributeDto: CreateAttributeDto) {
    return this.categoryAttributesService.createAttribute(createCategoryAttributeDto);
  }

  @UseGuards(AdminGuard)
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
    @Param('id', new ParseUUIDPipe({ version: '4' })) storeId: string,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.categoryAttributesService.findStoreCategories(this.ownStore(storeId, user));
  }
}
