import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ValidationPipe,
  Put,
  UseInterceptors,
  UploadedFiles,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  BadRequestException,
  Query,
  ParseUUIDPipe
} from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto, CreateProductVariantDto } from './dto/create-product.dto';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { Roles } from '@shared/decorators/role.decorator';
import { RolesGuard } from '@shared/guards/role.guard';
import { fileUploadInterceptor } from './interceptor/file-upload.interceptor';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { PaginationParams } from '@shared/helper/pagination-params.dto';
import { StaffRole } from '@generated/enums';
import type { AccessTokenPayload, CurrentUserType } from '@auth/models/auth.model';
@UseGuards(AuthJWTGuard)
@Controller('product')
export class ProductController {
  constructor(private readonly productService: ProductService) { }

  @UseGuards(RolesGuard)
  @Roles(StaffRole.MANAGER, StaffRole.OWNER)
  @Post()
  create(
    @Body() createProductDto: CreateProductDto,
  ) {
    return this.productService.createProduct(createProductDto);
  }

  @UseGuards(RolesGuard)
  @Roles(StaffRole.MANAGER, StaffRole.OWNER)
  @Post()
  createVariant(
    @Body() dto: CreateProductVariantDto,
  ) {
    return this.productService.createProductVariant(dto);
  }

  @UseGuards(RolesGuard)
  @Roles(StaffRole.MANAGER, StaffRole.OWNER)
  @Post('img/upload/:id')
  @UseInterceptors(fileUploadInterceptor)
  uploadPhoto(
    @UploadedFiles(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 7 * 1024 * 1024 }), //7MB
          new FileTypeValidator({ fileType: /^image\/(png|jpeg)$/ }),
        ],
        exceptionFactory(error) {
          if (error.includes('type')) {
            throw new BadRequestException('File type is not image!');
          } else if (error.includes('size')) {
            throw new BadRequestException('File size is big than 7MB!');
          } else {
            throw new BadRequestException(error);
          }
        },
        fileIsRequired: false
      }),
    ) photo: Array<Express.Multer.File>,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.productService.handleFile(photo, id, user.staff.storeId)
  }

  @UseGuards(RolesGuard)
  @Roles(StaffRole.MANAGER, StaffRole.OWNER)
  @Delete('img/delete/:id')
  removePhoto(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: any,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.productService.removeFile(id, body, user.staff.storeId)
  }

  @Get()
  findAll(@Query() { skip, limit }: PaginationParams) {
    return this.productService.findAll(skip, limit);
  }

  // @Get('search')
  // search(@Query('text') text: string) {
  //   return this.productService.findByNameOrBrand(text);
  // }

  // @Get(':id')
  // findOne(
  //   @Param() { id }: ParamsWithId,
  //   @Query() { color, size }: QueryWithSizeAndColor
  // ) {
  //   return this.productService.findOne(id, { color, size });
  // }

  // @UseGuards(RolesGuard)
  // @Roles(ROLE.ADMIN, ROLE.MANAGER)
  // @Delete(':id')
  // remove(@Param() { id }: ParamsWithId) {
  //   return this.productService.remove(id);
  // }


}
