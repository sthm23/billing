import { Controller, Get, Post, Body, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { DebtQueryParams, DebtorsQueryParams } from './dto/param.dto';
import { DebtService } from './debt.service';
import { CreateDebtDto, CreateDebtPaymentDto } from './dto/create-debt.dto';
import { CurrentUser } from '@shared/decorators/user.decorator';
import type { CurrentUser as UserInfo } from '@auth/models/auth.model';
import { AuthJWTGuard } from '@auth/guard/auth.guard';

@UseGuards(AuthJWTGuard)
@Controller('debt')
export class DebtController {
  constructor(private readonly debtService: DebtService) { }

  @Post()
  create(
    @Body() createDebtDto: CreateDebtDto,
    @CurrentUser() user: UserInfo,
  ) {
    return this.debtService.createCustomerDebt(createDebtDto, user);
  }


  @Post('payment')
  createPayment(
    @Body() dto: CreateDebtPaymentDto,
    @CurrentUser() user: UserInfo,
  ) {
    return this.debtService.createDebtPayment(dto, user);
  }

  @Get()
  findAll(
    @CurrentUser() user: UserInfo,
    @Query() params: DebtQueryParams,
  ) {
    return this.debtService.findAll(params, user);
  }

  @Get('debtors')
  getDebtors(
    @Query() params: DebtorsQueryParams,
    @CurrentUser() user: UserInfo,
  ) {
    return this.debtService.getDebtors(params, user);
  }

  /** DEBT orders without a customer (older data) */
  @Get('debtors/unassigned')
  getUnassignedDebts(@CurrentUser() user: UserInfo) {
    return this.debtService.getDebtor(null, user);
  }

  @Get('debtors/:customerId')
  getDebtor(
    @Param('customerId', new ParseUUIDPipe({ version: '4' })) customerId: string,
    @CurrentUser() user: UserInfo,
  ) {
    return this.debtService.getDebtor(customerId, user);
  }

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: UserInfo,
  ) {
    return this.debtService.findOne(id, user);
  }
}
