import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BookingView, cancelBookingSchema, createBookingSchema } from '@driva/shared';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BookingsService } from './bookings.service';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @Roles('client')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createBookingSchema)) body: { quoteId: string; vehicleId: string },
  ): Promise<BookingView> {
    return this.bookings.create(user, body.quoteId, body.vehicleId);
  }

  /** The client who booked or the driver who accepted. Anyone else gets 404. */
  @Get(':id')
  @Roles('client', 'driver')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<BookingView> {
    return this.bookings.get(user, id);
  }

  @Post(':id/cancel')
  @Roles('client')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelBookingSchema)) body: { reason?: string },
  ): Promise<BookingView> {
    return this.bookings.cancel(user, id, body.reason);
  }
}
