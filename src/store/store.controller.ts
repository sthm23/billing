import { Controller, Get, Post, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { StoreService } from './store.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { CurrentUser } from '@shared/decorators/user.decorator';
import type { UserWithAuthAndAdmin } from '@auth/models/auth.model';
import { AdminGuard } from '@shared/guards/admin.guard';
import { AuthJWTGuard } from '@auth/guard/auth.guard';

@UseGuards(AdminGuard, AuthJWTGuard)
@Controller('store')
export class StoreController {
  constructor(private readonly storeService: StoreService) { }

  @Post()
  create(
    @CurrentUser() user: UserWithAuthAndAdmin,
    @Body() createStoreDto: CreateStoreDto
  ) {
    return this.storeService.create(createStoreDto, user.id);
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
