import {
  Body,
  Controller,
  Get,
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
import { CreateRentalPaymentDto } from './dto/rental-payment.dto';
import {
  RentalAvailabilityQuery,
  RentalCalendarQuery,
  RentalListQuery,
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

  @Get('calendar')
  getCalendar(
    @Query() query: RentalCalendarQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.rentalService.getCalendar(query, user);
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
}
