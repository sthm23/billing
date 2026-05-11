import { Controller, Get, Post, Body, Param, Delete, ParseUUIDPipe, Query, UseGuards, Patch } from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto, CreateOrderItemDto, CreateOrderPaymentDto } from './dto/create-order.dto';
import { CreateReturnOrderDto } from './dto/create-return.dto';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { type CurrentUser as CurrentUserType } from '@auth/models/auth.model';
import { OrderQueryParams } from './entities/order.entity';

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

  @Post('return')
  createReturn(
    @Body() dto: CreateReturnOrderDto,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.orderService.createReturn(dto, user);
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
    @Query() { pageSize, currentPage, search, status, fromDate, toDate }: OrderQueryParams,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.orderService.findAll({ pageSize, currentPage, search, status, fromDate, toDate }, user);
  }

  @Get('search')
  searchOrder(
    @Query() { search }: OrderQueryParams,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.orderService.searchOrders(search!, user);
  }

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.orderService.findOne(id, user);
  }

  @Patch(':id/clear-customer')
  clearCustomerFromOrder(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string
  ) {
    return this.orderService.clearCustomerFromOrder(id);
  }

  @Delete(':id')
  remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.orderService.remove(id, user);
  }
}
