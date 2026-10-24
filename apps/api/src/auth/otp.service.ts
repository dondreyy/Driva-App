import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OTP_LENGTH } from '@driva/shared';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/config';
import { inTransaction, PG_POOL } from '../database/database.module';
import { SMS_SENDER, SmsSender } from './sms/sms-sender';

export const OTP_TTL_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_PER_HOUR = 5;

@Injectable()
export class OtpService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Creates a code for `phone` and texts it. Limits how often one number can ask. */
  async send(phone: string): Promise<{ expiresIn: number }> {
    const { rows } = await this.pool.query<{
      last_hour: number;
      seconds_since_last: number | null;
    }>(
      `SELECT count(*)::int AS last_hour,
              extract(epoch FROM now() - max(created_at))::int AS seconds_since_last
       FROM otp_codes WHERE phone = $1 AND created_at > now() - interval '1 hour'`,
      [phone],
    );
    const recent = rows[0];
    if (recent && recent.last_hour >= OTP_MAX_PER_HOUR) {
      throw new HttpException(
        'Too many codes requested for this number. Try again in an hour.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (
      recent?.seconds_since_last != null &&
      recent.seconds_since_last < OTP_RESEND_COOLDOWN_SECONDS
    ) {
      throw new HttpException(
        `Wait ${OTP_RESEND_COOLDOWN_SECONDS - recent.seconds_since_last} seconds before asking for another code.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
    await this.pool.query(
      `INSERT INTO otp_codes (phone, code_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [phone, this.hash(phone, code), OTP_TTL_MINUTES],
    );
    try {
      await this.sms.send(
        phone,
        `Your Driva code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes. Do not share it.`,
      );
    } catch {
      throw new ServiceUnavailableException('We could not send the code. Please try again.');
    }
    return { expiresIn: OTP_TTL_MINUTES * 60 };
  }

  /** Checks the latest code for `phone`. A code works once and allows a few wrong guesses. */
  async verify(phone: string, code: string): Promise<void> {
    const failure = await inTransaction(this.pool, async (db) => {
      const { rows } = await db.query<{
        id: string;
        code_hash: string;
        attempts: number;
        expired: boolean;
      }>(
        `SELECT id, code_hash, attempts, expires_at <= now() AS expired
         FROM otp_codes WHERE phone = $1 AND used_at IS NULL
         ORDER BY created_at DESC LIMIT 1
         FOR UPDATE`,
        [phone],
      );
      const otp = rows[0];
      if (!otp || otp.expired) {
        return new BadRequestException('This code has expired. Ask for a new one.');
      }
      if (otp.attempts >= OTP_MAX_ATTEMPTS) {
        return new HttpException(
          'Too many wrong codes. Ask for a new one.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (!safeEqual(otp.code_hash, this.hash(phone, code))) {
        await db.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);
        return new BadRequestException('That code is not right. Check the SMS and try again.');
      }
      await db.query(`UPDATE otp_codes SET used_at = now() WHERE phone = $1 AND used_at IS NULL`, [
        phone,
      ]);
      return null;
    });
    // Thrown after commit so the wrong-attempt count is saved.
    if (failure) throw failure;
  }

  private hash(phone: string, code: string): string {
    return createHmac('sha256', this.config.otpPepper).update(`${phone}:${code}`).digest('hex');
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
