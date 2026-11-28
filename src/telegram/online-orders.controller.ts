import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import type { CurrentUser as UserInfo } from '@auth/models/auth.model';
import { StaffRole } from '@generated/enums';
import { Roles } from '@shared/decorators/role.decorator';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { RolesGuard } from '@shared/guards/role.guard';
import {
  ConfirmOnlineOrderDto,
  OnlineOrderListParams,
  RejectOnlineOrderDto,
} from './dto/online-order.dto';
import {
  type ConfirmedOnlineOrder,
  type OnlineOrderDetails,
  type OnlineOrderList,
  OnlineOrderService,
} from './online-order.service';

/**
 * Requests from the Telegram shop, for the store's employees who work with orders:
 * owner, manager, seller. The store is the employee's own, never taken from the request.
 */
@UseGuards(AuthJWTGuard, RolesGuard)
@Roles(StaffRole.OWNER, StaffRole.MANAGER, StaffRole.SELLER)
@Controller('online-orders')
export class OnlineOrdersController {
  constructor(private readonly service: OnlineOrderService) {}

  @Get()
  list(
    @Query() params: OnlineOrderListParams,
    @CurrentUser() user: UserInfo,
  ): Promise<OnlineOrderList> {
    return this.service.list(params, user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserInfo,
  ): Promise<OnlineOrderDetails> {
    return this.service.findOne(id, user);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmOnlineOrderDto,
    @CurrentUser() user: UserInfo,
  ): Promise<ConfirmedOnlineOrder> {
    return this.service.confirm(id, dto, user);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectOnlineOrderDto,
    @CurrentUser() user: UserInfo,
  ): Promise<{ customerNotified: boolean }> {
    return this.service.reject(id, dto, user);
  }
}
