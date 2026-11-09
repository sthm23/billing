import { Module } from '@nestjs/common';
import { RentalController } from './rental.controller';
import { RentalService } from './rental.service';
import { RentalAvailabilityService } from './rental-availability.service';
import { RentalCleaningService } from './rental-cleaning.service';

@Module({
  controllers: [RentalController],
  providers: [RentalService, RentalAvailabilityService, RentalCleaningService],
})
export class RentalModule {}
