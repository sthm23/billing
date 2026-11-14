import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { FileService } from './file.service';
import { CreateProductImageResponseDto } from './dto/create-file.dto';
import { UserRole, StaffRole } from '@generated/enums';
import { Roles } from '@shared/decorators/role.decorator';
import { RolesGuard } from '@shared/guards/role.guard';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { CurrentUser } from '@shared/decorators/user.decorator';
import type { CurrentUser as CurrentUserType } from '@auth/models/auth.model';

@UseGuards(AuthJWTGuard)
@Controller('image')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER, StaffRole.MANAGER)
  @Post('upload')
  requestUpload(
    @Body() body: CreateProductImageResponseDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.fileService.createProductImage(body, user);
  }
}
