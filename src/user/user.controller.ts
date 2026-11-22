import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  ValidationPipe,
  UseGuards,
  NotFoundException,
  Put,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateCustomerDto, UpdateUserDto } from './dto/update-user.dto';
import { RolesGuard } from '@shared/guards/role.guard';
import { AdminGuard } from '@shared/guards/admin.guard';
import { Roles } from '@shared/decorators/role.decorator';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { UserRole } from '@generated/enums';
import { PaginationParams } from '@shared/dto/pagination-params.dto';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { type CurrentUser as CurrentUserType } from '@auth/models/auth.model';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) { }

  // Not used by the clients; staff/owners/customers are created via their own routes
  @UseGuards(AuthJWTGuard, AdminGuard)
  @Post()
  create(@Body(new ValidationPipe()) createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  @Roles(UserRole.OWNER)
  @UseGuards(AuthJWTGuard, RolesGuard)
  @Get('owners')
  findOwners(
    @Query() { pageSize, currentPage }: PaginationParams,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.userService.findAllOwners(pageSize, currentPage, user);
  }

  @UseGuards(AuthJWTGuard)
  @Post('customers')
  createCustomers(
    @Body(new ValidationPipe()) createUserDto: CreateUserDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.userService.createCustomers(createUserDto, user);
  }

  @UseGuards(AuthJWTGuard)
  @Put('customers/set-to-order')
  setCustomerToOrder(
    @Body(new ValidationPipe()) updateCustomerDto: UpdateCustomerDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.userService.setCustomerToOrder(updateCustomerDto, user);
  }

  @UseGuards(AuthJWTGuard)
  @Get('customers')
  getCustomers(
    @Query() { pageSize, currentPage }: PaginationParams,
    @Query('search') search: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.userService.getCustomers(pageSize, currentPage, search, user);
  }

  @UseGuards(AuthJWTGuard)
  @Get(':id')
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const user = await this.userService.findOneById(id, currentUser);
    if (!user) {
      return new NotFoundException('User not found');
    }
    return user;
  }

  @UseGuards(AuthJWTGuard)
  @Get(':id/info')
  async findOneInfo(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const user = await this.userService.findOneInfo(id, currentUser);
    if (!user) {
      return new NotFoundException('User not found');
    }
    return user;
  }

  @Roles(UserRole.OWNER)
  @UseGuards(AuthJWTGuard, RolesGuard)
  @Get()
  findAll(
    @Query() { pageSize, currentPage }: PaginationParams,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.userService.findAll(pageSize, currentPage, user);
  }

  @UseGuards(AuthJWTGuard, RolesGuard)
  @Delete(':id')
  @Roles(UserRole.OWNER)
  deactivate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.userService.deactivate(id, user);
  }
}
