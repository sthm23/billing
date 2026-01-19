import { Controller, Get, Post, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { StoreService } from './store.service';
import { CreateOwnerDto, CreateStaffDto, CreateStoreDto } from './dto/create-store.dto';
import { CurrentUser } from '@shared/decorators/user.decorator';
import type { UserAuth } from '@auth/models/auth.model';
import { AdminGuard } from '@shared/guards/admin.guard';
import { AuthJWTGuard } from '@auth/guard/auth.guard';

@UseGuards(AuthJWTGuard, AdminGuard)
@Controller('store')
export class StoreController {
  constructor(private readonly storeService: StoreService) { }

  @Post()
  create(
    @CurrentUser() user: UserAuth,
    @Body() createStoreDto: CreateStoreDto
  ) {
    return this.storeService.createStore(createStoreDto, user.id);
  }

  @Post('owner')
  createOwner(
    @Body() createStoreDto: CreateOwnerDto
  ) {
    return this.storeService.createOwner(createStoreDto);
  }

  @Post('staff')
  createStaff(
    @Body() createStoreDto: CreateStaffDto
  ) {
    return this.storeService.createStaff(createStoreDto);
  }

  @Get()
  findAll() {
    return this.storeService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.storeService.findOne(id);
  }
}
