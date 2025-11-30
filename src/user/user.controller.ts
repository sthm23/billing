import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe, ValidationPipe, UseGuards, NotFoundException } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RolesGuard } from '@utils/guards/role.guard';
import { Roles } from '@utils/decorators/role.decorator';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { User } from '@utils/decorators/user.decorator';
import { type JWTPayload } from '@auth/models/auth.model';
import ParamsWithId from '@utils/helper/param-with-id.dto';
import { ROLE } from '@generated/enums';


@UseGuards(RolesGuard)
@UseGuards(AuthJWTGuard)
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) { }

  @Post()
  @Roles(ROLE.ADMIN)
  create(@Body(new ValidationPipe()) createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  @Get()
  @Roles(ROLE.ADMIN, ROLE.MANAGER)
  findAll(@User() payload: JWTPayload) {
    return this.userService.findAll(payload);
  }

  @Get(':id')
  async findOne(@Param() { id }: ParamsWithId) {
    const user = await this.userService.findOneById(id);
    if (!user) {
      return new NotFoundException('User not found');
    }
    return user;
  }

  @Patch(':id')
  @Roles(ROLE.ADMIN, ROLE.MANAGER)
  update(@Param() { id }: ParamsWithId, @Body(new ValidationPipe()) updateUserDto: UpdateUserDto) {
    return this.userService.update(id, updateUserDto);
  }

  @Delete(':id')
  @Roles(ROLE.ADMIN)
  remove(@Param() { id }: ParamsWithId) {
    return this.userService.remove(id);
  }
}
