import { Controller, Get, Post, Body, Param, Delete, ValidationPipe, UseGuards, NotFoundException, Put, ParseUUIDPipe, Query } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RolesGuard } from '@shared/guards/role.guard';
import { Roles } from '@shared/decorators/role.decorator';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { StaffRole, UserRole } from '@generated/enums';
import { PaginationParams } from '@shared/helper/pagination-params.dto';


@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) { }

  @Post()
  create(@Body(new ValidationPipe()) createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  @Get(':id')
  async findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const user = await this.userService.findOneById(id);
    if (!user) {
      return new NotFoundException('User not found');
    }
    return user;
  }

  @Roles(UserRole.OWNER)
  @UseGuards(AuthJWTGuard, RolesGuard)
  @Get()
  findAll(@Query() { pageSize, currentPage }: PaginationParams) {
    return this.userService.findAll(pageSize, currentPage);
  }

  @UseGuards(AuthJWTGuard, RolesGuard)
  @Put(':id')
  @Roles(UserRole.OWNER)
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ValidationPipe()) updateUserDto: UpdateUserDto
  ) {
    return this.userService.update(id, updateUserDto);
  }

  @UseGuards(AuthJWTGuard, RolesGuard)
  @Delete(':id')
  @Roles(UserRole.OWNER)
  remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.userService.remove(id);
  }
}
