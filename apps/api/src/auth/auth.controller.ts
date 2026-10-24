import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AuthTokens,
  otpRequestSchema,
  otpVerifySchema,
  ParsedOtpRequest,
  ParsedOtpVerify,
  ParsedRefresh,
  ParsedSignup,
  refreshSchema,
  SignupResult,
  signupSchema,
  VerifyResult,
} from '@driva/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { Public } from './decorators';
import { OtpService } from './otp.service';
import { TokensService } from './tokens.service';

/** Tighter per-IP limit for the sign in routes, on top of the per-number OTP limits. */
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Public()
@Throttle(AUTH_THROTTLE)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
    private readonly tokens: TokensService,
  ) {}

  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body(new ZodValidationPipe(otpRequestSchema)) body: ParsedOtpRequest) {
    return this.otp.send(body.phone);
  }

  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(
    @Body(new ZodValidationPipe(otpVerifySchema)) body: ParsedOtpVerify,
  ): Promise<VerifyResult> {
    return this.auth.verify(body);
  }

  @Post('signup')
  signup(@Body(new ZodValidationPipe(signupSchema)) body: ParsedSignup): Promise<SignupResult> {
    return this.auth.signup(body);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: ParsedRefresh): Promise<AuthTokens> {
    return this.tokens.rotate(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body(new ZodValidationPipe(refreshSchema)) body: ParsedRefresh): Promise<void> {
    await this.tokens.revoke(body.refreshToken);
  }
}
