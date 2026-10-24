import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import type { LatLng, Place, PlaceSuggestion } from '@driva/shared';
import { SMS_SENDER, SmsSender } from '../src/auth/sms/sms-sender';
import { MAPS_PROVIDER, MapsProvider, Route } from '../src/maps/maps-provider';
import { configureApp } from '../src/main';

export const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl && process.env.REQUIRE_DATABASE) {
  throw new Error('REQUIRE_DATABASE is set but DATABASE_URL is not');
}
/** Database tests are skipped without DATABASE_URL, except in CI where they are required. */
export const describeDb = databaseUrl ? describe : describe.skip;

process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-at-least-32-chars';
process.env.OTP_PEPPER ??= 'test-otp-pepper-that-is-at-least-32-chars';
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString('base64');
process.env.STORAGE_LOCAL_DIR ??= join(tmpdir(), 'driva-test-storage');
// Tests run the matching sweep themselves, so timing is under their control.
process.env.MATCHING_WORKER ??= 'off';

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

/** Fixed distances and a few places, so prices in tests do not depend on Google. */
export class FakeMaps implements MapsProvider {
  /** Next route distance in metres; null means "no route". */
  nextDistanceMeters: number | null = 9_000;

  async search(query: string): Promise<PlaceSuggestion[]> {
    return [{ placeId: 'p1', title: `${query} result`, subtitle: 'Lagos' }];
  }

  async details(placeId: string): Promise<Place | null> {
    return placeId === 'p1' ? { label: 'Eko Hotel', lat: 6.4262, lng: 3.4307 } : null;
  }

  async reverse(at: LatLng): Promise<Place | null> {
    return { label: 'Admiralty Way', ...at };
  }

  async route(from: LatLng, to: LatLng): Promise<Route | null> {
    if (this.nextDistanceMeters === null) return null;
    return { distanceMeters: this.nextDistanceMeters, durationSeconds: 1200, path: [from, to] };
  }
}

export async function createTestApp(
  sms: SmsSender = new FakeSms(),
  maps: MapsProvider = new FakeMaps(),
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SMS_SENDER)
    .useValue(sms)
    .overrideProvider(MAPS_PROVIDER)
    .useValue(maps)
    .compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return app;
}

/** Sign up and sign in through the real API, as the apps do. */
export class Flows {
  constructor(
    private readonly server: App,
    private readonly pool: Pool,
    private readonly sms: FakeSms,
  ) {}

  /** Asks for a code, skipping the resend wait so tests do not sleep for 60 seconds. */
  async requestCode(phone: string): Promise<string> {
    await this.pool.query(
      `UPDATE otp_codes SET created_at = created_at - interval '2 minutes' WHERE phone = $1`,
      [phone],
    );
    await request(this.server).post('/v1/auth/otp/request').send({ phone }).expect(200);
    return this.sms.lastCode(phone);
  }

  async signUp(phone: string, app: 'client' | 'driver' = 'client', fullName = 'Tolu Adebayo') {
    const code = await this.requestCode(phone);
    const verify = await request(this.server)
      .post('/v1/auth/otp/verify')
      .send({ phone, code, app })
      .expect(200);
    const signup = await request(this.server)
      .post('/v1/auth/signup')
      .send({ signupToken: verify.body.signupToken, fullName, consent: true })
      .expect(201);
    return signup.body as { accessToken: string; refreshToken: string; user: { id: string } };
  }

  /** Creates a staff account directly, as the staff:create command does, and signs in. */
  async staff(phone: string, role: 'admin' | 'vetting_officer', fullName = 'Ada Obi') {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO users (role, phone, full_name) VALUES ($1, $2, $3) RETURNING id`,
      [role, phone, fullName],
    );
    const code = await this.requestCode(phone);
    const res = await request(this.server)
      .post('/v1/auth/otp/verify')
      .send({ phone, code, app: 'admin' })
      .expect(200);
    return { id: rows[0]!.id, accessToken: res.body.accessToken as string };
  }
}

let phoneSeq = 0;
/** Numbers in the +2349000 range belong to tests and are deleted at the start of a run. */
export function testPhone(): string {
  phoneSeq += 1;
  return `+2349000${String(process.pid % 1000).padStart(3, '0')}${String(phoneSeq).padStart(3, '0')}`;
}

export async function clearTestUsers(pool: Pool): Promise<void> {
  const testUsers = `SELECT id FROM users WHERE phone LIKE '+2349000%'`;
  // Bookings first (their offers go with them), then drivers, whose vetting checks point at test officers.
  await pool.query(`DELETE FROM bookings WHERE client_id IN (${testUsers}) OR driver_id IN (${testUsers})`);
  await pool.query(
    `DELETE FROM drivers WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '+2349000%')`,
  );
  await pool.query(`DELETE FROM users WHERE phone LIKE '+2349000%'`);
  await pool.query(`DELETE FROM otp_codes WHERE phone LIKE '+2349000%'`);
}
