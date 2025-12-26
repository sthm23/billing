import { Controller, Get, Post, Body, Param, Delete, ValidationPipe, UseGuards, NotFoundException, Put } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RolesGuard } from '@utils/guards/role.guard';
import { Roles } from '@utils/decorators/role.decorator';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { User } from '@utils/decorators/user.decorator';
import type { UserAuth, JWTPayload } from '@auth/models/auth.model';
import ParamsWithId from '@utils/helper/param-with-id.dto';
import { StaffRole } from '@generated/enums';


@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) { }

  @Post()
  create(@Body(new ValidationPipe()) createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  @Get(':id')
  async findOne(@Param() { id }: ParamsWithId) {
    const user = await this.userService.findOneById(id);
    if (!user) {
      return new NotFoundException('User not found');
    }
    return user;
  }

  @Roles(StaffRole.OWNER)
  @UseGuards(AuthJWTGuard, RolesGuard)
  @Get()
  findAll() {
    return this.userService.findAll();
  }

  @UseGuards(AuthJWTGuard, RolesGuard)
  @Put(':id')
  @Roles(StaffRole.OWNER)
  update(@Param() { id }: ParamsWithId, @Body(new ValidationPipe()) updateUserDto: UpdateUserDto) {
    return this.userService.update(id, updateUserDto);
  }

  @UseGuards(AuthJWTGuard, RolesGuard)
  @Delete(':id')
  @Roles(StaffRole.OWNER)
  remove(@Param() { id }: ParamsWithId) {
    return this.userService.remove(id);
  }
}
