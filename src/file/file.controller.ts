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

}
