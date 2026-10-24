import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { SMS_SENDER, SmsSender } from '../src/auth/sms/sms-sender';
import { configureApp } from '../src/main';

export const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl && process.env.REQUIRE_DATABASE) {
  throw new Error('REQUIRE_DATABASE is set but DATABASE_URL is not');
}
/** Database tests are skipped without DATABASE_URL, except in CI where they are required. */
export const describeDb = databaseUrl ? describe : describe.skip;

process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-at-least-32-chars';
process.env.OTP_PEPPER ??= 'test-otp-pepper-that-is-at-least-32-chars';

/** Captures texts instead of sending them, so tests can read the login code. */
export class FakeSms implements SmsSender {
  readonly sent: { phone: string; message: string }[] = [];

  async send(phone: string, message: string): Promise<void> {
    this.sent.push({ phone, message });
  }

  lastCode(phone: string): string {
    const last = [...this.sent].reverse().find((s) => s.phone === phone);
    const code = last?.message.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error('No code was sent to that number');
    return code;
  }
}

export async function createTestApp(sms: SmsSender = new FakeSms()): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SMS_SENDER)
    .useValue(sms)
    .compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return app;
}
