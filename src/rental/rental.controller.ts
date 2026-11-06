import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthJWTGuard } from '@auth/guard/auth.guard';
import { CurrentUser } from '@shared/decorators/user.decorator';
import { type CurrentUser as CurrentUserType } from '@auth/models/auth.model';
import { RentalService } from './rental.service';
import { CreateRentalDto, UpdateRentalDto } from './dto/create-rental.dto';
import {
  CancelRentalDto,
  CleaningConflictsQuery,
  IssueRentalDto,
  RentalReturnDto,
} from './dto/rental-lifecycle.dto';
import { CreateRentalPaymentDto } from './dto/rental-payment.dto';
import {
  RentalAgendaQuery,
  RentalAvailabilityQuery,
  RentalCalendarQuery,
  RentalListQuery,
  RentalSimilarQuery,
} from './dto/rental-query.dto';

/**
 * Rental bookings. Every route requires staff of a store with rental enabled;
 * store and warehouse access are checked in the service.
 */
@UseGuards(AuthJWTGuard)
@Controller('rental')
export class RentalController {
  constructor(private readonly rentalService: RentalService) {}

  @Get('availability')
  getAvailability(
    @Query() query: RentalAvailabilityQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.rentalService.getAvailability(query, user);
  }

  @Get('summary')
  getSummary(@CurrentUser() user: CurrentUserType) {
    return this.rentalService.getSummary(user);
  }

  @Get('similar')
  findSimilar(
    @Query() query: RentalSimilarQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.rentalService.findSimilar(query, user);
  }

  @Get('calendar')
  getCalendar(
    @Query() query: RentalCalendarQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.rentalService.getCalendar(query, user);
  }

  @Get('agenda')
  getAgenda(
    @Query() query: RentalAgendaQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.rentalService.getAgenda(query, user);
  }

  @Post()
  create(@Body() dto: CreateRentalDto, @CurrentUser() user: CurrentUserType) {
    return this.rentalService.create(dto, user);
  }

  @Get()
  findAll(
    @Query() query: RentalListQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.rentalService.findAll(query, user);
  }

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.rentalService.findOne(id, user);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateRentalDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.rentalService.update(id, dto, user);
  }

  @Post(':id/payments')
  addPayments(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CreateRentalPaymentDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.rentalService.addPayments(id, dto, user);
  }

  @Post(':id/issue')
  issue(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: IssueRentalDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.rentalService.issue(id, dto, user);
  }

  @Get(':id/cleaning-conflicts')
  getCleaningConflicts(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: CleaningConflictsQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.rentalService.getCleaningConflicts(id, query, user);
  }

  @Post(':id/returns/preview')
  @HttpCode(HttpStatus.OK)
  previewReturn(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: RentalReturnDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.rentalService.previewReturn(id, dto, user);
  }

  @Post(':id/returns')
  createReturn(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: RentalReturnDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.rentalService.createReturn(id, dto, user);
  }

  @Post(':id/collaterals/:collateralId/return')
  returnCollateral(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('collateralId', new ParseUUIDPipe({ version: '4' }))
    collateralId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.rentalService.returnCollateral(id, collateralId, user);
  }

  /** OWNER/MANAGER — checked in the service */
  @Post(':id/cancel')
  cancel(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CancelRentalDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.rentalService.cancel(id, dto, user);
  }
}
