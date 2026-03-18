import { Controller, Get, Post, Body, Param, Delete, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto, CreateOrderItemDto, CreateOrderPaymentDto } from './dto/create-order.dto';
import { PaginationParams } from '@shared/dto/pagination-params.dto';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { type CurrentUser as CurrentUserType } from '@auth/models/auth.model';

@UseGuards(AuthJWTGuard)
@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) { }

  @Post()
  create(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.orderService.create(dto, user);
  }

  @Post('items')
  createOrderItems(
    @Body() dto: CreateOrderItemDto
  ) {
    return this.orderService.createOrderItems(dto);
  }

  @Post('payment/:id')
  createOrderPayment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) orderId: string,
    @Body() dto: CreateOrderPaymentDto,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.orderService.createPayment(orderId, dto, user);
  }

  @Get()
  findAll(
    @Query() { pageSize, currentPage }: PaginationParams,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.orderService.findAll(pageSize, currentPage, user);
  }

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.orderService.findOne(id, user);
  }

  @Delete(':id')
  remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.orderService.remove(id, user);
  }
}
