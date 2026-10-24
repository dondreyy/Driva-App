import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  AdminDriverView,
  approveDriverSchema,
  assignCheckSchema,
  ParsedVettingResult,
  revealSchema,
  StaffMember,
  UploadTicket,
  uploadRequestSchema,
  VettingCheckView,
  VettingQueueItem,
  vettingResultSchema,
} from '@driva/shared';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { VettingService } from './vetting.service';

/** VeriQuest officers and Driva admins. */
@Roles('admin', 'vetting_officer')
@Controller('admin')
export class VettingController {
  constructor(private readonly vetting: VettingService) {}

  @Get('vetting/queue')
  queue(): Promise<VettingQueueItem[]> {
    return this.vetting.queue();
  }

  @Get('staff')
  staff(): Promise<StaffMember[]> {
    return this.vetting.staff();
  }

  @Get('drivers/:id')
  driver(@Param('id', ParseUUIDPipe) id: string): Promise<AdminDriverView> {
    return this.vetting.driver(id);
  }

  @Post('drivers/:id/reveal')
  @HttpCode(200)
  reveal(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(revealSchema)) body: { field: 'nin' | 'licenceNumber' },
  ): Promise<{ value: string }> {
    return this.vetting.reveal(actor, id, body.field);
  }

  @Post('drivers/:id/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(approveDriverSchema))
    body: { note?: string; vettingFeeWaived?: boolean },
  ): Promise<AdminDriverView> {
    return this.vetting.approve(actor, id, body);
  }

  @Post('vetting/:checkId/assign')
  @HttpCode(200)
  assign(
    @CurrentUser() actor: AuthUser,
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @Body(new ZodValidationPipe(assignCheckSchema))
    body: { officerId: string; scheduledFor?: string },
  ): Promise<VettingCheckView> {
    return this.vetting.assign(actor, checkId, body.officerId, body.scheduledFor);
  }

  @Post('vetting/:checkId/evidence')
  @HttpCode(200)
  evidence(
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @Body(new ZodValidationPipe(uploadRequestSchema)) body: { contentType: string },
  ): Promise<UploadTicket> {
    return this.vetting.evidenceUpload(checkId, body.contentType);
  }

  @Post('vetting/:checkId/result')
  @HttpCode(200)
  result(
    @CurrentUser() actor: AuthUser,
    @Param('checkId', ParseUUIDPipe) checkId: string,
    @Body(new ZodValidationPipe(vettingResultSchema)) body: ParsedVettingResult,
  ): Promise<AdminDriverView> {
    return this.vetting.recordResult(actor, checkId, body);
  }
}
