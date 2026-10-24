import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  BookingView,
  PhotoPhase,
  TrackView,
  tripPhotoSchema,
  tripPhotoUploadSchema,
  tripPinSchema,
  UploadTicket,
} from '@driva/shared';
import { AuthUser, CurrentUser, Public, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TripsService } from './trips.service';

@Controller()
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Post('trips/:id/arrived')
  @Roles('driver')
  @HttpCode(200)
  arrived(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BookingView> {
    return this.trips.arrived(user, id);
  }

  @Post('trips/:id/pin')
  @Roles('driver')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  pin(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(tripPinSchema)) body: { pin: string },
  ): Promise<BookingView> {
    return this.trips.checkPin(user, id, body.pin);
  }

  @Post('trips/:id/photos/upload')
  @Roles('driver')
  @HttpCode(200)
  photoUpload(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(tripPhotoUploadSchema))
    body: { phase: PhotoPhase; shot: string; contentType: string },
  ): Promise<UploadTicket> {
    return this.trips.photoUpload(user, id, body.phase, body.shot, body.contentType);
  }

  @Put('trips/:id/photos')
  @Roles('driver')
  savePhoto(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(tripPhotoSchema))
    body: { phase: PhotoPhase; shot: string; key: string; lat?: number; lng?: number },
  ): Promise<BookingView> {
    return this.trips.savePhoto(user, id, body);
  }

  @Post('trips/:id/start')
  @Roles('driver')
  @HttpCode(200)
  start(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BookingView> {
    return this.trips.start(user, id);
  }

  @Post('trips/:id/end')
  @Roles('driver')
  @HttpCode(200)
  end(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<BookingView> {
    return this.trips.end(user, id);
  }

  @Post('trips/:id/share')
  @Roles('client')
  @HttpCode(200)
  share(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ url: string; expiresAt: string }> {
    return this.trips.share(user, id);
  }

  /** Opened by anyone with the link. The random token is the only key. */
  @Get('track/:token')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  track(@Param('token') token: string): Promise<TrackView> {
    return this.trips.track(token);
  }
}
