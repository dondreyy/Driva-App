import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  BookingView,
  DriverOffer,
  driverLocationSchema,
  ShiftView,
  startShiftSchema,
  UploadTicket,
  uploadRequestSchema,
} from '@driva/shared';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MatchingService } from './matching.service';
import { ShiftsService } from './shifts.service';

@Roles('driver')
@Controller()
export class MatchingController {
  constructor(
    private readonly shifts: ShiftsService,
    private readonly matching: MatchingService,
  ) {}

  @Get('drivers/me/shift')
  shift(@CurrentUser() user: AuthUser): Promise<ShiftView> {
    return this.shifts.view(user.id);
  }

  @Post('drivers/me/shift/selfie')
  @HttpCode(200)
  selfie(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(uploadRequestSchema)) body: { contentType: string },
  ): Promise<UploadTicket> {
    return this.shifts.selfieUpload(user.id, body.contentType);
  }

  @Post('drivers/me/shift/start')
  @HttpCode(200)
  start(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(startShiftSchema))
    body: { selfieKey: string; lat: number; lng: number },
  ): Promise<ShiftView> {
    return this.shifts.start(user.id, body.selfieKey, body);
  }

  @Post('drivers/me/shift/end')
  @HttpCode(200)
  end(@CurrentUser() user: AuthUser): Promise<ShiftView> {
    return this.shifts.end(user.id);
  }

  @Post('drivers/me/location')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async location(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(driverLocationSchema))
    body: { lat: number; lng: number; heading?: number },
  ): Promise<void> {
    await this.shifts.location(user.id, body);
  }

  /** Polled by the driver app while online. Real time delivery comes with the trip WebSocket. */
  @Get('drivers/me/offer')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async offer(@CurrentUser() user: AuthUser): Promise<{ offer: DriverOffer | null }> {
    return { offer: await this.matching.currentOffer(user.id) };
  }

  @Post('offers/:id/accept')
  @HttpCode(200)
  accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BookingView> {
    return this.matching.accept(user.id, id);
  }

  @Post('offers/:id/decline')
  @HttpCode(204)
  async decline(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.matching.decline(user.id, id);
  }
}
