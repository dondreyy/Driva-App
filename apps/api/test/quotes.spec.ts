import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  clearTestUsers,
  createTestApp,
  databaseUrl,
  describeDb,
  FakeMaps,
  FakeSms,
  Flows,
  testPhone,
} from './helpers';

// Inside the pilot service area.
const LEKKI = { lat: 6.4478, lng: 3.4723, label: 'Lekki Phase 1' };
const VI = { lat: 6.4281, lng: 3.4219, label: 'Victoria Island' };
// Outside it: fine as a destination, not as a pickup.
const IKEJA = { lat: 6.5833, lng: 3.35, label: 'Ikeja GRA' };

/** Tomorrow (or `days` ahead) at hh:mm Lagos time, as ISO with the +01:00 offset. */
function lagos(hh: number, mm = 0, days = 1): string {
  const lagosNow = new Date(Date.now() + 60 * 60 * 1000);
  const d = new Date(
    Date.UTC(lagosNow.getUTCFullYear(), lagosNow.getUTCMonth(), lagosNow.getUTCDate() + days),
  );
  const date = d.toISOString().slice(0, 10);
  return `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+01:00`;
}

describeDb('Quotes', () => {
  let app: INestApplication;
  let server: App;
  let pool: Pool;
  let flows: Flows;
  let client: { accessToken: string; user: { id: string } };
  const maps = new FakeMaps();

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await clearTestUsers(pool);
    const sms = new FakeSms();
    app = await createTestApp(sms, maps);
    server = app.getHttpServer();
    flows = new Flows(server, pool, sms);
    client = await flows.signUp(testPhone(), 'client');
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  beforeEach(() => {
    maps.nextDistanceMeters = 9_000;
  });

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const quote = (body: object, token = client.accessToken) =>
    request(server).post('/v1/quotes').set(as(token)).send(body);

  describe('Ride with me: N3,500 an hour, at least 2 hours', () => {
    it('prices 3 daytime hours at N10,500 and shows the hourly rate', async () => {
      const res = await quote({
        tripType: 'ride_with_me',
        pickup: LEKKI,
        hours: 3,
        pickupAt: lagos(10),
      }).expect(201);
      expect(res.body).toMatchObject({
        tripType: 'ride_with_me',
        hours: 3,
        isNight: false,
        baseFareKobo: 1_050_000,
        nightKobo: 0,
        totalFareKobo: 1_050_000,
        hourlyRateKobo: 350_000,
        destination: null,
        pickup: LEKKI,
      });
    });

    it('refuses under 2 hours and over 12', async () => {
      await quote({ tripType: 'ride_with_me', pickup: LEKKI, hours: 1 }).expect(400);
      await quote({ tripType: 'ride_with_me', pickup: LEKKI, hours: 13 }).expect(400);
    });
  });

  describe('Drive my car alone: N2,500 plus N300 a km, rounded to the nearest N100', () => {
    it.each([
      [9_000, 9, 520_000], // 2,500 + 2,700
      [12_150, 12.2, 620_000], // 12.2 km: 2,500 + 3,660 = 6,160 -> 6,200
      [31_000, 31, 1_180_000], // the airport in the prototype
    ])('%i m of road is %s km and costs %i kobo', async (meters, km, kobo) => {
      maps.nextDistanceMeters = meters;
      const res = await quote({
        tripType: 'drive_alone',
        pickup: LEKKI,
        destination: VI,
        task: 'Run an errand',
        pickupAt: lagos(10),
      }).expect(201);
      expect(res.body).toMatchObject({
        distanceKm: km,
        totalFareKobo: kobo,
        task: 'Run an errand',
        destination: VI,
      });
    });

    it('can go anywhere, but must start inside the service area', async () => {
      await quote({
        tripType: 'drive_alone',
        pickup: LEKKI,
        destination: IKEJA,
        task: 'Deliver car',
        pickupAt: lagos(10),
      }).expect(201);
      const res = await quote({
        tripType: 'drive_alone',
        pickup: IKEJA,
        destination: LEKKI,
        task: 'Deliver car',
      }).expect(422);
      expect(res.body.message).toBe('Driva does not pick up from there yet');
    });

    it('says so when there is no road route', async () => {
      maps.nextDistanceMeters = null;
      await quote({
        tripType: 'drive_alone',
        pickup: LEKKI,
        destination: VI,
        task: 'Deliver car',
      }).expect(422);
    });

    it('stores the planned route for later tracking', async () => {
      const res = await quote({
        tripType: 'drive_alone',
        pickup: LEKKI,
        destination: VI,
        task: 'Deliver car',
      }).expect(201);
      const row = await pool.query(
        `SELECT ST_NPoints(planned_route::geometry) AS n FROM quotes WHERE id = $1`,
        [res.body.id],
      );
      expect(row.rows[0].n).toBe(2);
    });
  });

  describe('Night: pickups from 9pm to 5am Lagos time add N1,500', () => {
    it.each([
      [20, 59, false],
      [21, 0, true],
      [23, 30, true],
      [4, 59, true],
      [5, 0, false],
    ])('a pickup at %i:%i is night: %s', async (hh, mm, night) => {
      const res = await quote({
        tripType: 'ride_with_me',
        pickup: LEKKI,
        hours: 2,
        pickupAt: lagos(hh, mm),
      }).expect(201);
      expect(res.body).toMatchObject({
        isNight: night,
        baseFareKobo: 700_000,
        nightKobo: night ? 150_000 : 0,
        totalFareKobo: night ? 850_000 : 700_000,
      });
    });
  });

  describe('when', () => {
    it('refuses a time in the past or more than 7 days ahead', async () => {
      await quote({
        tripType: 'ride_with_me',
        pickup: LEKKI,
        hours: 2,
        pickupAt: lagos(10, 0, -1),
      }).expect(400);
      await quote({
        tripType: 'ride_with_me',
        pickup: LEKKI,
        hours: 2,
        pickupAt: lagos(10, 0, 8),
      }).expect(400);
    });

    it('treats no time as now and holds the price for 15 minutes', async () => {
      const res = await quote({ tripType: 'ride_with_me', pickup: LEKKI, hours: 2 }).expect(201);
      expect(res.body.pickupAt).toBeNull();
      const ttl = new Date(res.body.expiresAt).getTime() - Date.now();
      expect(ttl).toBeGreaterThan(14 * 60_000);
      expect(ttl).toBeLessThanOrEqual(15 * 60_000);
    });
  });

  it('uses a city’s own price rule over the default', async () => {
    const lagosId = (await pool.query(`SELECT id FROM cities WHERE name = 'Lagos'`)).rows[0].id;
    const rule = await pool.query(
      `INSERT INTO pricing_rules (city_id, hourly_rate_kobo, effective_from) VALUES ($1, 400000, now() - interval '1 minute') RETURNING id`,
      [lagosId],
    );
    try {
      const res = await quote({
        tripType: 'ride_with_me',
        pickup: LEKKI,
        hours: 2,
        pickupAt: lagos(10),
      }).expect(201);
      expect(res.body).toMatchObject({ totalFareKobo: 800_000, hourlyRateKobo: 400_000 });
    } finally {
      await pool.query(`DELETE FROM quotes WHERE pricing_rule_id = $1`, [rule.rows[0].id]);
      await pool.query(`DELETE FROM pricing_rules WHERE id = $1`, [rule.rows[0].id]);
    }
  });

  it('never takes a price from the app', async () => {
    await quote({ tripType: 'ride_with_me', pickup: LEKKI, hours: 2, totalFareKobo: 1 }).expect(
      400,
    );
  });

  it('shows a quote only to the client who asked for it', async () => {
    const res = await quote({ tripType: 'ride_with_me', pickup: LEKKI, hours: 2 }).expect(201);
    await request(server).get(`/v1/quotes/${res.body.id}`).set(as(client.accessToken)).expect(200);
    const other = await flows.signUp(testPhone(), 'client');
    await request(server).get(`/v1/quotes/${res.body.id}`).set(as(other.accessToken)).expect(404);
    const driver = await flows.signUp(testPhone(), 'driver');
    await quote({ tripType: 'ride_with_me', pickup: LEKKI, hours: 2 }, driver.accessToken).expect(
      403,
    );
  });

  describe('places', () => {
    it('searches and resolves places for clients only', async () => {
      const search = await request(server)
        .get('/v1/places/search?q=eko&lat=6.44&lng=3.47')
        .set(as(client.accessToken))
        .expect(200);
      expect(search.body).toEqual([{ placeId: 'p1', title: 'eko result', subtitle: 'Lagos' }]);
      const details = await request(server)
        .get('/v1/places/details/p1')
        .set(as(client.accessToken))
        .expect(200);
      expect(details.body).toEqual({ label: 'Eko Hotel', lat: 6.4262, lng: 3.4307 });
      await request(server).get('/v1/places/details/nope').set(as(client.accessToken)).expect(404);
      await request(server).get('/v1/places/search?q=e').set(as(client.accessToken)).expect(400);
      await request(server)
        .get('/v1/places/reverse?lat=6.44')
        .set(as(client.accessToken))
        .expect(400);
      await request(server)
        .get('/v1/places/reverse?lat=6.44&lng=3.47')
        .set(as(client.accessToken))
        .expect(200);
      const driver = await flows.signUp(testPhone(), 'driver');
      await request(server).get('/v1/places/search?q=eko').set(as(driver.accessToken)).expect(403);
    });
  });

  describe('vehicles', () => {
    it('saves a client’s cars and keeps them private', async () => {
      const owner = await flows.signUp(testPhone(), 'client');
      const res = await request(server)
        .post('/v1/vehicles')
        .set(as(owner.accessToken))
        .send({
          makeModel: 'Toyota Camry 2018',
          plateNumber: 'lnd 482 kj',
          transmission: 'automatic',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        makeModel: 'Toyota Camry 2018',
        plateNumber: 'LND 482 KJ',
        colour: null,
      });
      const list = await request(server).get('/v1/vehicles').set(as(owner.accessToken)).expect(200);
      expect(list.body).toHaveLength(1);
      const someoneElse = await request(server)
        .get('/v1/vehicles')
        .set(as(client.accessToken))
        .expect(200);
      expect(someoneElse.body.map((v: { id: string }) => v.id)).not.toContain(res.body.id);
      await request(server)
        .post('/v1/vehicles')
        .set(as(owner.accessToken))
        .send({
          makeModel: 'Toyota Camry',
          plateNumber: 'LND 482 KJ',
          transmission: 'automatic',
          ownerUserId: client.user.id,
        })
        .expect(400);
    });
  });
});
