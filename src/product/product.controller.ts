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
  Query
} from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { Roles } from '@shared/decorators/role.decorator';
import { RolesGuard } from '@shared/guards/role.guard';
import { fileUploadInterceptor } from './interceptor/file-upload.interceptor';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { PaginationParams } from '@shared/helper/pagination-params.dto';
import { StaffRole } from '@generated/enums';
import type { AccessTokenPayload } from '@auth/models/auth.model';

@Controller('product')
export class ProductController {
  constructor(private readonly productService: ProductService) { }

  @UseGuards(RolesGuard)
  @UseGuards(AuthJWTGuard)
  @Roles(StaffRole.MANAGER, StaffRole.OWNER)
  @Post()
  create(
    @Body(
      new ValidationPipe({
        transform: true,
      }),
    ) createProductDto: CreateProductDto,
    @CurrentUser() payload: AccessTokenPayload
  ) {
    return this.productService.createProduct(createProductDto, payload);
  }

  @UseGuards(RolesGuard)
  @UseGuards(AuthJWTGuard)
  @Roles(StaffRole.MANAGER, StaffRole.OWNER)
  @Post('upload-photo')
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
  ) {
    return this.productService.handleFile(photo)
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
  // @UseGuards(AuthJWTGuard)
  // @Roles(ROLE.ADMIN, ROLE.MANAGER)
  // @Delete(':id')
  // remove(@Param() { id }: ParamsWithId) {
  //   return this.productService.remove(id);
  // }

  // @UseGuards(RolesGuard)
  // @UseGuards(AuthJWTGuard)
  // @Roles(ROLE.ADMIN, ROLE.MANAGER)
  // @Put(':id')
  // update(@Param() { id }: ParamsWithId, @Body(
  //   new ValidateSizePipe(),
  //   new ValidationPipe({
  //     transform: true,
  //   }),
  // ) updateProductDto: CreateProductDto) {
  //   return this.productService.updateProduct(id, updateProductDto);
  // }

  // @UseGuards(RolesGuard)
  // @UseGuards(AuthJWTGuard)
  // @Roles(ROLE.ADMIN, ROLE.MANAGER)
  // @Patch(':id')
  // updateProductSize(@Param() { id }: ParamsWithId, @Body() updateProductDto: UpdateProductSizeDTO) {
  //   return this.productService.updateProductSize(id, updateProductDto);
  // }
}
