import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig } from '../config/config';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessTokenGuard, RolesGuard } from './guards';
import { OtpService } from './otp.service';
import { createSmsSender, SMS_SENDER } from './sms/sms-sender';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtSecret,
        signOptions: { algorithm: 'HS256', issuer: 'driva' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'driva' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokensService,
    { provide: SMS_SENDER, inject: [APP_CONFIG], useFactory: createSmsSender },
    // Order matters: the token guard sets request.user before the roles guard reads it.
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [TokensService],
})
export class AuthModule {}
