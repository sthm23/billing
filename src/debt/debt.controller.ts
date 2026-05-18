import { Controller, Get, Post, Body, Patch, Param, Delete, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { DebtService } from './debt.service';
import { CreateDebtDto, CreateDebtPaymentDto } from './dto/create-debt.dto';
import { UpdateDebtDto } from './dto/update-debt.dto';
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
    @Param() params: any,
  ) {
    return this.debtService.findAll(params, user);
  }

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.debtService.findOne(id);
  }
}
