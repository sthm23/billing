import { Controller, Get, Post, Body, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { CreatePaymentDto, CreateReturnPaymentDto } from './dto/create-payment.dto';
import { PaginationParams } from '@shared/dto/pagination-params.dto';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { type CurrentUser as CurrentUserType } from '@auth/models/auth.model';

@UseGuards(AuthJWTGuard)
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) { }

  @Post()
  create(
    @Body() createPaymentDto: CreatePaymentDto,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.paymentService.create(createPaymentDto, user);
  }

  @Post('return/:id')
  createReturnPayment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() createPaymentDto: CreateReturnPaymentDto,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.paymentService.createPaymentForReturnOrder(id, createPaymentDto, user);
  }

  @Get()
  findAll(
    @Query() { pageSize, currentPage }: PaginationParams,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.paymentService.findAll({ pageSize, currentPage }, user);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.paymentService.findOne(id);
  }
}
