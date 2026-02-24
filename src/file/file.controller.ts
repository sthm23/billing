import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { FileService } from './file.service';
import { CreateProductImageDto, CreateProductImageResponseDto } from './dto/create-file.dto';
import { UserRole, StaffRole } from '@generated/enums';
import { Roles } from '@shared/decorators/role.decorator';
import { RolesGuard } from '@shared/guards/role.guard';
import { AuthJWTGuard } from '@auth/guard/auth.guard';

@UseGuards(AuthJWTGuard)
@Controller('image')
export class FileController {
  constructor(private readonly fileService: FileService) { }

  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, StaffRole.MANAGER)
  @Post('upload')
  requestUpload(@Body() body: CreateProductImageResponseDto) {
    return this.fileService.createProductImage(body);
  }

  // @UseGuards(RolesGuard)
  // @Roles(UserRole.OWNER, StaffRole.MANAGER)
  // @Post('img/upload')
  // @UseInterceptors(fileUploadInterceptor)
  // uploadPhoto(
  //   @UploadedFiles(
  //     new ParseFilePipe({
  //       validators: [
  //         new MaxFileSizeValidator({ maxSize: 7 * 1024 * 1024 }), //7MB
  //         new FileTypeValidator({ fileType: /^image\/(png|jpeg)$/ }),
  //       ],
  //       exceptionFactory(error) {
  //         if (error.includes('type')) {
  //           throw new BadRequestException('File type is not image!');
  //         } else if (error.includes('size')) {
  //           throw new BadRequestException('File size is big than 7MB!');
  //         } else {
  //           throw new BadRequestException(error);
  //         }
  //       },
  //       fileIsRequired: false
  //     }),
  //   ) photo: Array<Express.Multer.File>
  // ) {
  //   return this.productService.handleFile(photo)
  // }

  @Get()
  findAll() {
    return this.fileService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.fileService.findOne(+id);
  }

  // @UseGuards(RolesGuard)
  // @Roles(StaffRole.MANAGER)
  // @Delete('img/delete/:id')
  // removePhoto(
  //   @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  //   @Body() body: any,
  //   @CurrentUser() user: CurrentUser
  // ) {
  //   return this.fileService.remove(id, body, user.staff.storeId)
  // }
}
