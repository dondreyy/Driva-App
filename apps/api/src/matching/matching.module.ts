import { Module } from '@nestjs/common';
import { BookingsController } from '../bookings/bookings.controller';
import { BookingsService } from '../bookings/bookings.service';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';
import { MatchingWorker } from './matching.worker';
import { ShiftsService } from './shifts.service';

@Module({
  controllers: [MatchingController, BookingsController],
  providers: [MatchingService, MatchingWorker, ShiftsService, BookingsService],
  exports: [MatchingService],
})
export class MatchingModule {}
