import { Controller, Get, Post, Body, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { CashboxService } from './cashbox.service';
import { CreateCashBoxDto, CreateCashTransactionDto } from './dto/create-cashbox.dto';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { type CurrentUser as CurrentUserType } from '@auth/models/auth.model';
import { AuthJWTGuard } from '@auth/guard/auth.guard';

@UseGuards(AuthJWTGuard)
@Controller('cashbox')
export class CashboxController {
  constructor(private readonly cashboxService: CashboxService) { }

  @Post()
  createCashbox(
    @Body() dto: CreateCashBoxDto,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.cashboxService.createCashBox(dto, user);
  }

  @Post('transaction/:id')
  createCashTransaction(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CreateCashTransactionDto,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.cashboxService.createCashTransaction(id, dto, user);
  }

  @Get()
  findAll(@CurrentUser() user: CurrentUserType) {
    return this.cashboxService.findAll({ pageSize: 10, currentPage: 1 }, user);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.cashboxService.findOne(id);
  }
}
