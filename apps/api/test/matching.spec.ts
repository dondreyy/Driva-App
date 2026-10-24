import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { MatchingService } from '../src/matching/matching.service';
import {
  clearTestUsers,
  createTestApp,
  databaseUrl,
  describeDb,
  FakeSms,
  Flows,
  testPhone,
} from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PICKUP = { lat: 6.4478, lng: 3.4723, label: 'Lekki Phase 1' };
/** Points east of the pickup: about 1, 3 and 9 km away. */
const KM1 = { lat: 6.4478, lng: 3.4813 };
const KM3 = { lat: 6.4478, lng: 3.4993 };
const KM9 = { lat: 6.4478, lng: 3.5543 };

describeDb('Matching', () => {
  let app: INestApplication;
  let server: App;
  let pool: Pool;
  let flows: Flows;
  let matching: MatchingService;
  let lagosId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await clearTestUsers(pool);
    const sms = new FakeSms();
    app = await createTestApp(sms);
    server = app.getHttpServer();
    flows = new Flows(server, pool, sms);
    matching = app.get(MatchingService);
    lagosId = (await pool.query(`SELECT id FROM cities WHERE name = 'Lagos'`)).rows[0].id;
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  // Every test starts with nobody online and no open trips.
  beforeEach(async () => {
    await pool.query(`DELETE FROM driver_presence`);
    await pool.query(`UPDATE driver_shifts SET ended_at = now() WHERE ended_at IS NULL`);
    await pool.query(`UPDATE booking_offers SET status = 'expired' WHERE status = 'offered'`);
    await pool.query(
      `UPDATE bookings SET status = 'cancelled' WHERE status IN ('requested', 'matching', 'accepted', 'driver_arrived', 'in_progress')`,
    );
  });

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** A driver VeriQuest has approved, created directly so tests stay quick. */
  async function approvedDriver(name = 'Emeka Okafor', vettedAt = 'now()') {
    const d = await flows.signUp(testPhone(), 'driver', name);
    await pool.query(
      `INSERT INTO drivers (user_id, city_id, status, approved_at, last_full_vetting_at)
       VALUES ($1, $2, 'approved', ${vettedAt}, ${vettedAt})`,
      [d.user.id, lagosId],
    );
    return d;
  }

  async function goOnline(token: string, at: { lat: number; lng: number }) {
    const ticket = await request(server)
      .post('/v1/drivers/me/shift/selfie')
      .set(as(token))
      .send({ contentType: 'image/jpeg' })
      .expect(200);
    await request(server)
      .put(new URL(ticket.body.url).pathname)
      .set('Content-Type', 'image/jpeg')
      .send(JPEG)
      .expect(200);
    return request(server)
      .post('/v1/drivers/me/shift/start')
      .set(as(token))
      .send({ selfieKey: ticket.body.key, ...at })
      .expect(200);
  }

  async function clientWithCar() {
    const c = await flows.signUp(testPhone(), 'client', 'Tolu Adebayo');
    const car = await request(server)
      .post('/v1/vehicles')
      .set(as(c.accessToken))
      .send({
        makeModel: 'Toyota Camry 2018',
        plateNumber: 'LND 482 KJ',
        transmission: 'automatic',
      })
      .expect(201);
    return { ...c, carId: car.body.id as string };
  }

  async function book(client: { accessToken: string; carId: string }, extra: object = {}) {
    const quote = await request(server)
      .post('/v1/quotes')
      .set(as(client.accessToken))
      .send({ tripType: 'ride_with_me', pickup: PICKUP, hours: 2, ...extra })
      .expect(201);
    const res = await request(server)
      .post('/v1/bookings')
      .set(as(client.accessToken))
      .send({ quoteId: quote.body.id, vehicleId: client.carId })
      .expect(201);
    return res.body;
  }

  const offerFor = async (token: string) =>
    (await request(server).get('/v1/drivers/me/offer').set(as(token)).expect(200)).body.offer;

  describe('going online', () => {
    it('only lets approved drivers with vetting under 12 months old go online', async () => {
      const applicant = await flows.signUp(testPhone(), 'driver');
      await pool.query(`INSERT INTO drivers (user_id, city_id) VALUES ($1, $2)`, [
        applicant.user.id,
        lagosId,
      ]);
      await request(server)
        .post('/v1/drivers/me/shift/selfie')
        .set(as(applicant.accessToken))
        .send({ contentType: 'image/jpeg' })
        .expect(403);

      const lapsed = await approvedDriver('Old Vetting', "now() - interval '13 months'");
      const shift = await request(server)
        .get('/v1/drivers/me/shift')
        .set(as(lapsed.accessToken))
        .expect(200);
      expect(shift.body).toMatchObject({ online: false, canGoOnline: false });
      await request(server)
        .post('/v1/drivers/me/shift/selfie')
        .set(as(lapsed.accessToken))
        .send({ contentType: 'image/jpeg' })
        .expect(403);
    });

    it('needs a selfie for every shift', async () => {
      const d = await approvedDriver();
      await request(server)
        .post('/v1/drivers/me/shift/start')
        .set(as(d.accessToken))
        .send({ selfieKey: `drivers/${d.user.id}/shift/never-uploaded.jpg`, ...KM1 })
        .expect(400);
      const res = await goOnline(d.accessToken, KM1);
      expect(res.body).toMatchObject({ online: true, canGoOnline: true, activeBookingId: null });
    });

    it('takes locations only while online', async () => {
      const d = await approvedDriver();
      await request(server)
        .post('/v1/drivers/me/location')
        .set(as(d.accessToken))
        .send(KM1)
        .expect(409);
      await goOnline(d.accessToken, KM1);
      await request(server)
        .post('/v1/drivers/me/location')
        .set(as(d.accessToken))
        .send({ ...KM3, heading: 90 })
        .expect(204);
    });
  });

  describe('requests', () => {
    it('offers a new trip to the nearest driver for 30 seconds, showing what they earn', async () => {
      const near = await approvedDriver('Near Driver');
      const far = await approvedDriver('Far Driver');
      await goOnline(near.accessToken, KM1);
      await goOnline(far.accessToken, KM3);
      const client = await clientWithCar();
      const booking = await book(client);
      expect(booking.status).toBe('matching');

      const offer = await offerFor(near.accessToken);
      expect(await offerFor(far.accessToken)).toBeNull();
      expect(offer).toMatchObject({
        bookingId: booking.id,
        tripType: 'ride_with_me',
        hours: 2,
        totalFareKobo: booking.totalFareKobo,
        commissionBps: 1500,
        commissionKobo: Math.round(booking.totalFareKobo * 0.15),
        driverEarningKobo: booking.totalFareKobo - Math.round(booking.totalFareKobo * 0.15),
      });
      expect(offer.kmToPickup).toBeCloseTo(1, 0);
      expect(offer.secondsLeft).toBeGreaterThan(25);
      expect(offer.secondsLeft).toBeLessThanOrEqual(30);
    });

    it('shows a driver past their first year the 20% rate', async () => {
      const veteran = await approvedDriver('Veteran Driver', "now() - interval '11 months'");
      await pool.query(
        `UPDATE drivers SET approved_at = now() - interval '13 months' WHERE user_id = $1`,
        [veteran.user.id],
      );
      await goOnline(veteran.accessToken, KM1);
      await book(await clientWithCar());
      expect((await offerFor(veteran.accessToken)).commissionBps).toBe(2000);
    });

    it('locks the fare when the driver accepts, and shows the client the driver card', async () => {
      const d = await approvedDriver('Emeka Okafor');
      await goOnline(d.accessToken, KM1);
      const client = await clientWithCar();
      const booking = await book(client);
      const offer = await offerFor(d.accessToken);

      const accepted = await request(server)
        .post(`/v1/offers/${offer.id}/accept`)
        .set(as(d.accessToken))
        .expect(200);
      expect(accepted.body).toMatchObject({
        status: 'accepted',
        totalFareKobo: booking.totalFareKobo,
        clientFirstName: 'Tolu',
        driverEarningKobo: null,
      });
      expect(accepted.body.fareLockedAt).not.toBeNull();

      const seen = await request(server)
        .get(`/v1/bookings/${booking.id}`)
        .set(as(client.accessToken))
        .expect(200);
      expect(seen.body.driver).toEqual({
        firstName: 'Emeka',
        photoUrl: null,
        ratingAvg: null,
        ratingCount: 0,
        vettedBy: 'VeriQuest',
      });
      expect(JSON.stringify(seen.body)).not.toMatch(/\+234/);

      const shift = await request(server)
        .get('/v1/drivers/me/shift')
        .set(as(d.accessToken))
        .expect(200);
      expect(shift.body.activeBookingId).toBe(booking.id);
      await request(server).post('/v1/drivers/me/shift/end').set(as(d.accessToken)).expect(409);

      const stranger = await approvedDriver('Stranger');
      await request(server)
        .get(`/v1/bookings/${booking.id}`)
        .set(as(stranger.accessToken))
        .expect(404);

      const audit = await pool.query(
        `SELECT details FROM audit_log WHERE action = 'booking.accepted' AND entity_id = $1`,
        [booking.id],
      );
      expect(audit.rows[0].details).toMatchObject({
        to: 'accepted',
        lockedFareKobo: booking.totalFareKobo,
      });
    });

    it('never lets two accepts of the same request both succeed', async () => {
      const d = await approvedDriver();
      await goOnline(d.accessToken, KM1);
      await book(await clientWithCar());
      const offer = await offerFor(d.accessToken);
      const results = await Promise.all([
        request(server).post(`/v1/offers/${offer.id}/accept`).set(as(d.accessToken)),
        request(server).post(`/v1/offers/${offer.id}/accept`).set(as(d.accessToken)),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const other = await approvedDriver('Other Driver');
      await request(server)
        .post(`/v1/offers/${offer.id}/accept`)
        .set(as(other.accessToken))
        .expect(404);
    });

    it('passes a declined request to the next nearest driver', async () => {
      const near = await approvedDriver('Near Driver');
      const far = await approvedDriver('Far Driver');
      await goOnline(near.accessToken, KM1);
      await goOnline(far.accessToken, KM3);
      const booking = await book(await clientWithCar());
      const first = await offerFor(near.accessToken);
      await request(server)
        .post(`/v1/offers/${first.id}/decline`)
        .set(as(near.accessToken))
        .expect(204);
      expect((await offerFor(far.accessToken)).bookingId).toBe(booking.id);
      expect(await offerFor(near.accessToken)).toBeNull();
    });

    it('moves on when 30 seconds pass without an answer, and the late accept fails', async () => {
      const near = await approvedDriver('Slow Driver');
      const far = await approvedDriver('Far Driver');
      await goOnline(near.accessToken, KM1);
      await goOnline(far.accessToken, KM3);
      const booking = await book(await clientWithCar());
      const first = await offerFor(near.accessToken);
      await pool.query(
        `UPDATE booking_offers SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [first.id],
      );
      await matching.sweep();
      expect((await offerFor(far.accessToken)).bookingId).toBe(booking.id);
      const late = await request(server)
        .post(`/v1/offers/${first.id}/accept`)
        .set(as(near.accessToken))
        .expect(409);
      expect(late.body.message).toMatch(/expired/);
    });

    it('skips drivers who are too far, offline, silent or already on a trip', async () => {
      const far = await approvedDriver('Nine Km');
      await goOnline(far.accessToken, KM9);
      const silent = await approvedDriver('Silent');
      await goOnline(silent.accessToken, KM1);
      await pool.query(
        `UPDATE driver_presence SET updated_at = now() - interval '3 minutes' WHERE driver_id = $1`,
        [silent.user.id],
      );
      const busy = await approvedDriver('Busy');
      await goOnline(busy.accessToken, KM1);
      await book(await clientWithCar());
      const busyOffer = await offerFor(busy.accessToken);
      await request(server)
        .post(`/v1/offers/${busyOffer.id}/accept`)
        .set(as(busy.accessToken))
        .expect(200);
      const offline = await approvedDriver('Offline');
      void offline;

      const booking = await book(await clientWithCar());
      expect(booking.status).toBe('matching');
      for (const d of [far, silent, busy]) expect(await offerFor(d.accessToken)).toBeNull();
    });

    it('gives up as no driver when the matching window ends', async () => {
      const client = await clientWithCar();
      const booking = await book(client);
      await matching.sweep();
      let seen = await request(server)
        .get(`/v1/bookings/${booking.id}`)
        .set(as(client.accessToken))
        .expect(200);
      expect(seen.body.status).toBe('matching');
      await pool.query(
        `UPDATE bookings SET matching_deadline = now() - interval '1 second' WHERE id = $1`,
        [booking.id],
      );
      await matching.sweep();
      seen = await request(server)
        .get(`/v1/bookings/${booking.id}`)
        .set(as(client.accessToken))
        .expect(200);
      expect(seen.body.status).toBe('no_driver');
      // The client can book again.
      await book(client);
    });

    it('waits until 30 minutes before a scheduled pickup', async () => {
      const d = await approvedDriver();
      await goOnline(d.accessToken, KM1);
      const inTwoDays = new Date(Date.now() + 2 * 86_400_000).toISOString();
      const booking = await book(await clientWithCar(), { pickupAt: inTwoDays });
      expect(booking.status).toBe('requested');
      await matching.sweep();
      expect(await offerFor(d.accessToken)).toBeNull();
      await pool.query(
        `UPDATE bookings SET scheduled_for = now() + interval '20 minutes', matching_deadline = now() + interval '20 minutes' WHERE id = $1`,
        [booking.id],
      );
      await matching.sweep();
      expect((await offerFor(d.accessToken)).bookingId).toBe(booking.id);
    });

    it('passes the request on when the driver goes offline', async () => {
      const leaving = await approvedDriver('Leaving');
      const staying = await approvedDriver('Staying');
      await goOnline(leaving.accessToken, KM1);
      await goOnline(staying.accessToken, KM3);
      const booking = await book(await clientWithCar());
      expect(await offerFor(leaving.accessToken)).not.toBeNull();
      await request(server)
        .post('/v1/drivers/me/shift/end')
        .set(as(leaving.accessToken))
        .expect(200);
      expect((await offerFor(staying.accessToken)).bookingId).toBe(booking.id);
    });
  });

  describe('booking rules', () => {
    it('lets the client cancel, which takes the request off the driver’s screen', async () => {
      const d = await approvedDriver();
      await goOnline(d.accessToken, KM1);
      const client = await clientWithCar();
      const booking = await book(client);
      const offer = await offerFor(d.accessToken);
      const current = await request(server)
        .get('/v1/bookings/current')
        .set(as(client.accessToken))
        .expect(200);
      expect(current.body.booking.id).toBe(booking.id);
      const res = await request(server)
        .post(`/v1/bookings/${booking.id}/cancel`)
        .set(as(client.accessToken))
        .send({ reason: 'Changed plans' })
        .expect(200);
      expect(res.body.status).toBe('cancelled');
      expect(await offerFor(d.accessToken)).toBeNull();
      await request(server)
        .post(`/v1/offers/${offer.id}/accept`)
        .set(as(d.accessToken))
        .expect(409);
      await request(server)
        .post(`/v1/bookings/${booking.id}/cancel`)
        .set(as(client.accessToken))
        .send({})
        .expect(409);
      const after = await request(server)
        .get('/v1/bookings/current')
        .set(as(client.accessToken))
        .expect(200);
      expect(after.body.booking).toBeNull();
    });

    it('books a quote once, only before it expires, only with the client’s own car, one trip at a time', async () => {
      const client = await clientWithCar();
      const other = await clientWithCar();
      const quote = await request(server)
        .post('/v1/quotes')
        .set(as(client.accessToken))
        .send({ tripType: 'ride_with_me', pickup: PICKUP, hours: 2 })
        .expect(201);
      await request(server)
        .post('/v1/bookings')
        .set(as(client.accessToken))
        .send({ quoteId: quote.body.id, vehicleId: other.carId })
        .expect(403);
      await request(server)
        .post('/v1/bookings')
        .set(as(other.accessToken))
        .send({ quoteId: quote.body.id, vehicleId: other.carId })
        .expect(404);

      await pool.query(`UPDATE quotes SET expires_at = now() - interval '1 second' WHERE id = $1`, [
        quote.body.id,
      ]);
      await request(server)
        .post('/v1/bookings')
        .set(as(client.accessToken))
        .send({ quoteId: quote.body.id, vehicleId: client.carId })
        .expect(422);
      await pool.query(
        `UPDATE quotes SET expires_at = now() + interval '10 minutes' WHERE id = $1`,
        [quote.body.id],
      );

      const booking = await request(server)
        .post('/v1/bookings')
        .set(as(client.accessToken))
        .send({ quoteId: quote.body.id, vehicleId: client.carId })
        .expect(201);
      expect(booking.body).toMatchObject({
        totalFareKobo: quote.body.totalFareKobo,
        status: 'matching',
      });
      await request(server)
        .post('/v1/bookings')
        .set(as(client.accessToken))
        .send({ quoteId: quote.body.id, vehicleId: client.carId })
        .expect(409);

      const second = await request(server)
        .post('/v1/quotes')
        .set(as(client.accessToken))
        .send({ tripType: 'ride_with_me', pickup: PICKUP, hours: 3 })
        .expect(201);
      const res = await request(server)
        .post('/v1/bookings')
        .set(as(client.accessToken))
        .send({ quoteId: second.body.id, vehicleId: client.carId })
        .expect(409);
      expect(res.body.message).toMatch(/already have a trip/);
    });
  });
});
