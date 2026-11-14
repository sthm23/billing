import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  ForbiddenException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  CreateSubcategoryDto,
  UpdateSubcategoryDto,
} from './dto/subcategory.dto';
import { CategoryAttributesService } from './category-attributes.service';
import {
  CreateAttributeDto,
  CreateAttributeValueDto,
} from './dto/create-category-attribute.dto';
import { PaginationParams } from '@shared/dto/pagination-params.dto';
import { IdParamDto } from '@shared/dto/id-param.dto';
import { AttributeParams } from './dto/attribute-params.dto';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { AdminGuard } from '@shared/guards/admin.guard';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { type CurrentUser as CurrentUserType } from '@auth/models/auth.model';
import { StaffRole, UserRole } from '@generated/enums';
import { Roles } from '@shared/decorators/role.decorator';
import { RolesGuard } from '@shared/guards/role.guard';

@UseGuards(AuthJWTGuard)
@Controller('category')
export class CategoryAttributesController {
  constructor(
    private readonly categoryAttributesService: CategoryAttributesService,
  ) {}

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
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.categoryAttributesService.findStoreBrands(
      this.ownStore(storeId, user),
    );
  }

  @Get('tag')
  findTags() {
    return this.categoryAttributesService.findTags();
  }

  @Get('attributes')
  getAttributes(@Query() pagination: AttributeParams) {
    return this.categoryAttributesService.findAttributes(pagination);
  }

  @Get('attributes/store/:id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) storeId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.categoryAttributesService.findStoreAttributes(
      this.ownStore(storeId, user),
    );
  }

  @Get('attributes/items')
  getAttributeItems(@Query() { attributeIds }: IdParamDto) {
    const idArray = attributeIds.split(',');
    return this.categoryAttributesService.getAttributeItems(idArray);
  }

  @Get('attributes/:id')
  getAttributeItem(
    @Param('id', new ParseUUIDPipe({ version: '4' })) attrId: string,
  ) {
    return this.categoryAttributesService.findAttributeItem(attrId);
  }

  @UseGuards(AdminGuard)
  @Post('attribute')
  createAttribute(@Body() createCategoryAttributeDto: CreateAttributeDto) {
    return this.categoryAttributesService.createAttribute(
      createCategoryAttributeDto,
    );
  }

  /** Find or create a value: store OWNER (attribute of their store) or ADMIN. Always 200. */
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, StaffRole.OWNER)
  @Post('attribute/value')
  @HttpCode(HttpStatus.OK)
  createAttributeValue(
    @Body() createCategoryAttributeDto: CreateAttributeValueDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.categoryAttributesService.createAttributeValue(
      createCategoryAttributeDto,
      user,
    );
  }

  @Get()
  getCategories() {
    return this.categoryAttributesService.findCategories();
  }

  /** Find or create a subcategory (staff OWNER of the direction's store, or ADMIN). Always 200. */
  @Post('subcategory')
  @HttpCode(HttpStatus.OK)
  findOrCreateSubcategory(
    @Body() dto: CreateSubcategoryDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.categoryAttributesService.findOrCreateSubcategory(dto, user);
  }

  @UseGuards(AdminGuard)
  @Patch('subcategory/:id')
  updateSubcategory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateSubcategoryDto,
  ) {
    return this.categoryAttributesService.updateSubcategory(id, dto);
  }

  @UseGuards(AdminGuard)
  @Delete('subcategory/:id')
  removeSubcategory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.categoryAttributesService.removeSubcategory(id);
  }

  @Get(':id/categories')
  findStoreCategories(
    @Param('id', new ParseUUIDPipe({ version: '4' })) storeId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.categoryAttributesService.findStoreCategories(
      this.ownStore(storeId, user),
    );
  }
}
