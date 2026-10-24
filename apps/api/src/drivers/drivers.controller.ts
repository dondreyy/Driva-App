import { Body, Controller, Get, HttpCode, Param, ParseEnumPipe, Post, Put } from '@nestjs/common';
import {
  DRIVER_DOCUMENT_KINDS,
  DriverApplication,
  driverConsentsSchema,
  driverDocumentSchema,
  DriverDocumentKind,
  driverGuarantorsSchema,
  driverHomeSchema,
  driverProfileSchema,
  ParsedDriverGuarantors,
  ParsedDriverProfile,
  UploadTicket,
  uploadRequestSchema,
} from '@driva/shared';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DriversService } from './drivers.service';

const kindPipe = new ParseEnumPipe(Object.fromEntries(DRIVER_DOCUMENT_KINDS.map((k) => [k, k])));

/** The signed in driver's own application. Every route is scoped to the caller's user id. */
@Roles('driver')
@Controller('drivers/me')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<DriverApplication> {
    return this.drivers.getApplication(user.id);
  }

  /** Same as GET /drivers/me. Kept because docs/API.md names it. */
  @Get('vetting')
  vetting(@CurrentUser() user: AuthUser): Promise<DriverApplication> {
    return this.drivers.getApplication(user.id);
  }

  @Put('profile')
  profile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(driverProfileSchema)) body: ParsedDriverProfile,
  ): Promise<DriverApplication> {
    return this.drivers.saveProfile(user.id, body);
  }

  @Put('home')
  home(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(driverHomeSchema)) body: { homeAddress: string },
  ): Promise<DriverApplication> {
    return this.drivers.saveHome(user.id, body.homeAddress);
  }

  @Put('guarantors')
  guarantors(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(driverGuarantorsSchema)) body: ParsedDriverGuarantors,
  ): Promise<DriverApplication> {
    return this.drivers.saveGuarantors(user.id, body);
  }

  @Post('documents/:kind/upload')
  @HttpCode(200)
  upload(
    @CurrentUser() user: AuthUser,
    @Param('kind', kindPipe) kind: DriverDocumentKind,
    @Body(new ZodValidationPipe(uploadRequestSchema)) body: { contentType: string },
  ): Promise<UploadTicket> {
    return this.drivers.createUpload(user.id, kind, body.contentType);
  }

  @Put('documents/:kind')
  document(
    @CurrentUser() user: AuthUser,
    @Param('kind', kindPipe) kind: DriverDocumentKind,
    @Body(new ZodValidationPipe(driverDocumentSchema)) body: { key: string },
  ): Promise<DriverApplication> {
    return this.drivers.saveDocument(user.id, kind, body.key);
  }

  @Put('consents')
  consents(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(driverConsentsSchema)) _body: unknown,
  ): Promise<DriverApplication> {
    return this.drivers.saveConsents(user.id);
  }

  @Post('submit')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser): Promise<DriverApplication> {
    return this.drivers.submit(user.id);
  }
}
