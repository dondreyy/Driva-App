/**
 * Runs against a real, migrated Postgres. Set DATABASE_URL to run it locally.
 * CI sets REQUIRE_DATABASE=1 so these tests can never be skipped there.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool, PoolClient } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl && process.env.REQUIRE_DATABASE) {
  throw new Error('REQUIRE_DATABASE is set but DATABASE_URL is not');
}
const describeDb = databaseUrl ? describe : describe.skip;

describeDb('API against Postgres', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/health reports the database is up', async () => {
    await request(app.getHttpServer())
      .get('/v1/health')
      .expect(200, { status: 'ok', database: 'up' });
  });
});

describeDb('Schema rules from the initial migration', () => {
  let pool: Pool;
  let db: PoolClient;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool.end();
  });

  // Each test runs in a transaction that is rolled back, so tests leave no data behind.
  beforeEach(async () => {
    db = await pool.connect();
    await db.query('BEGIN');
  });

  afterEach(async () => {
    await db.query('ROLLBACK');
    db.release();
  });

  async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    const { rows } = await db.query(sql, params);
    return rows[0] as T;
  }

  /** Runs `sql` inside a savepoint and returns the Postgres error it raised. */
  async function failure(sql: string, params: unknown[] = []): Promise<Error & { code?: string }> {
    await db.query('SAVEPOINT attempt');
    try {
      await db.query(sql, params);
    } catch (err) {
      await db.query('ROLLBACK TO SAVEPOINT attempt');
      return err as Error & { code?: string };
    }
    throw new Error(`Expected this to fail: ${sql}`);
  }

  let phoneSeq = 0;
  async function user(role: string): Promise<string> {
    phoneSeq += 1;
    const row = await one<{ id: string }>(
      `INSERT INTO users (role, phone, full_name) VALUES ($1, $2, 'Test User') RETURNING id`,
      [role, `+2340000000${String(phoneSeq).padStart(3, '0')}`],
    );
    return row.id;
  }

  async function lagos(): Promise<string> {
    return (await one<{ id: string }>(`SELECT id FROM cities WHERE name = 'Lagos'`)).id;
  }

  async function driver(): Promise<string> {
    const id = await user('driver');
    await db.query(
      `INSERT INTO drivers (user_id, city_id, status, approved_at) VALUES ($1, $2, 'approved', now())`,
      [id, await lagos()],
    );
    return id;
  }

  async function booking(fields: { driverId?: string; status?: string; hours?: number } = {}) {
    const clientId = await user('client');
    const vehicle = await one<{ id: string }>(
      `INSERT INTO vehicles (owner_user_id, make_model, plate_number) VALUES ($1, 'Toyota Camry', 'LND 482 KJ') RETURNING id`,
      [clientId],
    );
    return one<{ id: string }>(
      `INSERT INTO bookings (city_id, trip_type, status, client_id, driver_id, vehicle_id,
         pickup_label, pickup, hours, base_fare_kobo, total_fare_kobo)
       VALUES ($1, 'ride_with_me', $2, $3, $4, $5, 'Pickup',
         ST_GeogFromText('POINT(3.47 6.44)'), $6, 700000, 700000)
       RETURNING id`,
      [
        await lagos(),
        fields.status ?? 'requested',
        clientId,
        fields.driverId ?? null,
        vehicle.id,
        fields.hours ?? 2,
      ],
    );
  }

  it('seeds Lagos as a live city and a default pricing rule with the CLAUDE.md prices', async () => {
    expect(await one(`SELECT is_live FROM cities WHERE name = 'Lagos'`)).toEqual({ is_live: true });
    const rule = await one(
      `SELECT hourly_rate_kobo, min_hours, solo_base_kobo, solo_per_km_kobo, night_surcharge_kobo,
              commission_first_year_bps, commission_after_bps
       FROM pricing_rules WHERE city_id IS NULL`,
    );
    expect(rule).toEqual({
      hourly_rate_kobo: '350000',
      min_hours: 2,
      solo_base_kobo: '250000',
      solo_per_km_kobo: '30000',
      night_surcharge_kobo: '150000',
      commission_first_year_bps: 1500,
      commission_after_bps: 2000,
    });
  });

  it('allows only one active trip per driver', async () => {
    const driverId = await driver();
    await booking({ driverId, status: 'accepted' });
    const err = await failure(
      `UPDATE bookings SET driver_id = $1, status = 'in_progress' WHERE id = $2`,
      [driverId, (await booking()).id],
    );
    expect(err.code).toBe('23505');
    expect(err.message).toMatch(/one_active_trip_per_driver/);
  });

  it('lets a driver take a new trip once the last one is completed', async () => {
    const driverId = await driver();
    await booking({ driverId, status: 'completed' });
    await expect(booking({ driverId, status: 'accepted' })).resolves.toHaveProperty('id');
  });

  it('allows only one accepted offer per booking', async () => {
    const { id } = await booking({ status: 'matching' });
    const [a, b] = [await driver(), await driver()];
    for (const d of [a, b]) {
      await db.query(
        `INSERT INTO booking_offers (booking_id, driver_id, expires_at) VALUES ($1, $2, now() + interval '30 seconds')`,
        [id, d],
      );
    }
    await db.query(
      `UPDATE booking_offers SET status = 'accepted' WHERE booking_id = $1 AND driver_id = $2`,
      [id, a],
    );
    const err = await failure(
      `UPDATE booking_offers SET status = 'accepted' WHERE booking_id = $1 AND driver_id = $2`,
      [id, b],
    );
    expect(err.message).toMatch(/one_accepted_offer_per_booking/);
  });

  it('refuses a Ride with me booking under 2 hours', async () => {
    await db.query('SAVEPOINT attempt');
    await expect(booking({ hours: 1 })).rejects.toThrow(/bookings_hours_check/);
    await db.query('ROLLBACK TO SAVEPOINT attempt');
  });

  it('keeps the audit log append only', async () => {
    const row = await one<{ id: string }>(
      `INSERT INTO audit_log (action, entity, entity_id) VALUES ('test', 'booking', 'x') RETURNING id`,
    );
    expect(
      (await failure(`UPDATE audit_log SET action = 'changed' WHERE id = $1`, [row.id])).message,
    ).toMatch(/append only/);
    expect((await failure(`DELETE FROM audit_log WHERE id = $1`, [row.id])).message).toMatch(
      /append only/,
    );
  });

  it('refuses to resolve an incident without a note', async () => {
    const err = await failure(
      `INSERT INTO incidents (kind, status) VALUES ('emergency', 'resolved')`,
    );
    expect(err.message).toMatch(/incidents_check/);
  });
});
