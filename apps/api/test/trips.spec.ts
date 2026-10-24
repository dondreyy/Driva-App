import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  clearTestUsers,
  createTestApp,
  databaseUrl,
  describeDb,
  FakeSms,
  Flows,
  putPhoto,
  resetTrips,
  TripFlows,
} from './helpers';

const SHOTS = ['front', 'back', 'left', 'right', 'fuel_dash'];
const ON_THE_ROAD = { lat: 6.44, lng: 3.45 };

describeDb('The trip', () => {
  let app: INestApplication;
  let server: App;
  let pool: Pool;
  let trips: TripFlows;
  let baseUrl: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await clearTestUsers(pool);
    const sms = new FakeSms();
    app = await createTestApp(sms);
    // Listening for real, so sockets can connect.
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    server = app.getHttpServer();
    trips = new TripFlows(server, pool, new Flows(server, pool, sms));
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  beforeEach(() => resetTrips(pool));

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const post = (path: string, token: string, body: object = {}) =>
    request(server).post(`/v1${path}`).set(as(token)).send(body);
  const view = async (id: string, token: string) =>
    (await request(server).get(`/v1/bookings/${id}`).set(as(token)).expect(200)).body;

  async function photograph(id: string, token: string, phase: 'before' | 'after') {
    for (const shot of SHOTS) {
      const ticket = await post(`/trips/${id}/photos/upload`, token, {
        phase,
        shot,
        contentType: 'image/jpeg',
      }).expect(200);
      const key = await putPhoto(server, ticket.body);
      await request(server)
        .put(`/v1/trips/${id}/photos`)
        .set(as(token))
        .send({ phase, shot, key, ...ON_THE_ROAD })
        .expect(200);
    }
  }

  it('runs a Ride with me trip from arrival to the end, PIN first', async () => {
    const driver = await trips.approvedDriver('Emeka Okafor');
    const client = await trips.clientWithCar();
    const booking = await trips.accepted(client, driver);

    // The client sees the PIN; the driver never does.
    expect(booking.tripPin).toMatch(/^\d{4}$/);
    expect((await view(booking.id, driver.accessToken)).tripPin).toBeNull();

    await post(`/trips/${booking.id}/start`, driver.accessToken).expect(409);
    await post(`/trips/${booking.id}/pin`, driver.accessToken, { pin: booking.tripPin }).expect(
      409,
    );
    const arrived = await post(`/trips/${booking.id}/arrived`, driver.accessToken).expect(200);
    expect(arrived.body.status).toBe('driver_arrived');

    // A trip cannot start without the correct PIN.
    await post(`/trips/${booking.id}/start`, driver.accessToken).expect(409);
    const wrong = booking.tripPin === '0000' ? '1111' : '0000';
    const bad = await post(`/trips/${booking.id}/pin`, driver.accessToken, { pin: wrong }).expect(
      400,
    );
    expect(bad.body.message).toBe('That PIN is not right. 4 tries left.');
    await post(`/trips/${booking.id}/start`, driver.accessToken).expect(409);
    const ok = await post(`/trips/${booking.id}/pin`, driver.accessToken, {
      pin: booking.tripPin,
    }).expect(200);
    expect(ok.body.pinVerified).toBe(true);
    expect((await view(booking.id, client.accessToken)).tripPin).toBeNull();

    const started = await post(`/trips/${booking.id}/start`, driver.accessToken).expect(200);
    expect(started.body.status).toBe('in_progress');

    await post('/drivers/me/location', driver.accessToken, ON_THE_ROAD).expect(204);
    const live = await view(booking.id, client.accessToken);
    expect(live.driverLocation).toMatchObject(ON_THE_ROAD);

    const ended = await post(`/trips/${booking.id}/end`, driver.accessToken).expect(200);
    // The fare on a completed trip equals the fare quoted at acceptance.
    expect(ended.body).toMatchObject({
      status: 'completed',
      totalFareKobo: booking.totalFareKobo,
      commissionBps: 1500,
      commissionKobo: Math.round(booking.totalFareKobo * 0.15),
      driverEarningKobo: booking.totalFareKobo - Math.round(booking.totalFareKobo * 0.15),
    });
    const seenByClient = await view(booking.id, client.accessToken);
    expect(seenByClient).toMatchObject({
      status: 'completed',
      commissionKobo: null,
      driverEarningKobo: null,
      driverLocation: null,
    });

    const audit = await pool.query(
      `SELECT action, details FROM audit_log WHERE entity_id = $1 ORDER BY id`,
      [booking.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'booking.requested',
      'booking.matching',
      'booking.accepted',
      'booking.driver_arrived',
      'trip.pin_failed',
      'trip.pin_verified',
      'booking.in_progress',
      'booking.completed',
    ]);
    expect(audit.rows.at(-1).details).toMatchObject({
      commissionBps: 1500,
      totalFareKobo: booking.totalFareKobo,
    });
  });

  it('pauses PIN entry for 5 minutes after 5 wrong tries', async () => {
    const driver = await trips.approvedDriver();
    const booking = await trips.accepted(await trips.clientWithCar(), driver);
    await post(`/trips/${booking.id}/arrived`, driver.accessToken).expect(200);
    const wrong = booking.tripPin === '0000' ? '1111' : '0000';
    for (let i = 0; i < 4; i++)
      await post(`/trips/${booking.id}/pin`, driver.accessToken, { pin: wrong }).expect(400);
    const locked = await post(`/trips/${booking.id}/pin`, driver.accessToken, {
      pin: wrong,
    }).expect(429);
    expect(locked.body.message).toMatch(/Try again in 5 minutes/);
    // Even the right PIN waits out the pause.
    await post(`/trips/${booking.id}/pin`, driver.accessToken, { pin: booking.tripPin }).expect(
      429,
    );
    await pool.query(
      `UPDATE bookings SET pin_locked_until = now() - interval '1 second' WHERE id = $1`,
      [booking.id],
    );
    await post(`/trips/${booking.id}/pin`, driver.accessToken, { pin: booking.tripPin }).expect(
      200,
    );
  });

  it('needs five photos at handover and five at return for Drive my car alone', async () => {
    const driver = await trips.approvedDriver();
    const client = await trips.clientWithCar();
    const booking = await trips.accepted(client, driver, {
      tripType: 'drive_alone',
      destination: { lat: 6.4281, lng: 3.4219, label: 'Victoria Island' },
      task: 'Deliver car',
    });
    await post(`/trips/${booking.id}/arrived`, driver.accessToken).expect(200);
    await post(`/trips/${booking.id}/pin`, driver.accessToken, { pin: booking.tripPin }).expect(
      200,
    );

    const missing = await post(`/trips/${booking.id}/start`, driver.accessToken).expect(409);
    expect(missing.body.message).toMatch(/five handover photos/);
    await post(`/trips/${booking.id}/photos/upload`, driver.accessToken, {
      phase: 'after',
      shot: 'front',
      contentType: 'image/jpeg',
    }).expect(409);
    const ticket = await post(`/trips/${booking.id}/photos/upload`, driver.accessToken, {
      phase: 'before',
      shot: 'front',
      contentType: 'image/jpeg',
    }).expect(200);
    // A key for a different shot is refused.
    await request(server)
      .put(`/v1/trips/${booking.id}/photos`)
      .set(as(driver.accessToken))
      .send({ phase: 'before', shot: 'back', key: await putPhoto(server, ticket.body) })
      .expect(400);
    await photograph(booking.id, driver.accessToken, 'before');
    await post(`/trips/${booking.id}/start`, driver.accessToken).expect(200);

    await post(`/trips/${booking.id}/photos/upload`, driver.accessToken, {
      phase: 'before',
      shot: 'front',
      contentType: 'image/jpeg',
    }).expect(409);
    const noReturn = await post(`/trips/${booking.id}/end`, driver.accessToken).expect(409);
    expect(noReturn.body.message).toMatch(/five return photos/);
    await photograph(booking.id, driver.accessToken, 'after');
    await post(`/trips/${booking.id}/end`, driver.accessToken).expect(200);

    const seen = await view(booking.id, client.accessToken);
    expect(seen.photos).toHaveLength(10);
    // In the order they are taken: front, back, left, right, fuel and dash; handover first.
    expect(seen.photos.map((p: { phase: string; shot: string }) => `${p.phase}:${p.shot}`)).toEqual(
      [...SHOTS.map((s) => `before:${s}`), ...SHOTS.map((s) => `after:${s}`)],
    );
    // Photos open only through their signed links.
    await request(server).get(new URL(seen.photos[0].url).pathname).expect(200);
  });

  it('does not take car photos on Ride with me', async () => {
    const driver = await trips.approvedDriver();
    const booking = await trips.accepted(await trips.clientWithCar(), driver);
    await post(`/trips/${booking.id}/arrived`, driver.accessToken).expect(200);
    await post(`/trips/${booking.id}/photos/upload`, driver.accessToken, {
      phase: 'before',
      shot: 'front',
      contentType: 'image/jpeg',
    }).expect(400);
  });

  it('lets only the assigned driver move the trip', async () => {
    const driver = await trips.approvedDriver();
    const client = await trips.clientWithCar();
    const booking = await trips.accepted(client, driver);
    const other = await trips.approvedDriver('Other Driver');
    await post(`/trips/${booking.id}/arrived`, other.accessToken).expect(404);
    await post(`/trips/${booking.id}/arrived`, client.accessToken).expect(403);
  });

  it('charges 20% to a driver past their first year, stored on the trip', async () => {
    const veteran = await trips.approvedDriver('Veteran', '13 months');
    const booking = await trips.accepted(await trips.clientWithCar(), veteran);
    await post(`/trips/${booking.id}/arrived`, veteran.accessToken).expect(200);
    await post(`/trips/${booking.id}/pin`, veteran.accessToken, { pin: booking.tripPin }).expect(
      200,
    );
    await post(`/trips/${booking.id}/start`, veteran.accessToken).expect(200);
    const ended = await post(`/trips/${booking.id}/end`, veteran.accessToken).expect(200);
    expect(ended.body.commissionBps).toBe(2000);
    const row = await pool.query(`SELECT commission_bps FROM bookings WHERE id = $1`, [booking.id]);
    expect(row.rows[0].commission_bps).toBe(2000);
  });

  describe('share link', () => {
    it('shows the trip live to anyone with the link, without personal details, and stops after the trip', async () => {
      const driver = await trips.approvedDriver('Emeka Okafor');
      const client = await trips.clientWithCar();
      const booking = await trips.accepted(client, driver);
      await post(`/trips/${booking.id}/share`, driver.accessToken).expect(403);
      const share = await post(`/trips/${booking.id}/share`, client.accessToken).expect(200);
      expect(share.body.url).toMatch(/^http:\/\/localhost:8081\/track\/[\w-]{20,}$/);
      const token = share.body.url.split('/').pop();

      await post('/drivers/me/location', driver.accessToken, ON_THE_ROAD).expect(204);
      const live = await request(server).get(`/v1/track/${token}`).expect(200);
      expect(live.body).toMatchObject({
        status: 'accepted',
        driverFirstName: 'Emeka',
        vehicle: { plateNumber: 'LND 482 KJ' },
        location: ON_THE_ROAD,
      });
      expect(JSON.stringify(live.body)).not.toMatch(/\+234|Tolu|Okafor/);

      await post(`/trips/${booking.id}/arrived`, driver.accessToken).expect(200);
      await post(`/trips/${booking.id}/pin`, driver.accessToken, { pin: booking.tripPin }).expect(
        200,
      );
      await post(`/trips/${booking.id}/start`, driver.accessToken).expect(200);
      await post(`/trips/${booking.id}/end`, driver.accessToken).expect(200);
      const done = await request(server).get(`/v1/track/${token}`).expect(200);
      expect(done.body).toMatchObject({ status: 'completed', location: null });
      const link = await pool.query(
        `SELECT expires_at <= now() + interval '1 hour 1 minute' AS soon FROM trip_share_links WHERE booking_id = $1`,
        [booking.id],
      );
      expect(link.rows[0].soon).toBe(true);

      await pool.query(
        `UPDATE trip_share_links SET expires_at = now() - interval '1 second' WHERE booking_id = $1`,
        [booking.id],
      );
      await request(server).get(`/v1/track/${token}`).expect(404);
      await request(server).get('/v1/track/made-up-token').expect(404);
    });
  });

  describe('live updates', () => {
    const sockets: Socket[] = [];
    afterEach(() => sockets.splice(0).forEach((s) => s.close()));

    function connect(token?: string): Promise<Socket> {
      const socket = io(baseUrl, {
        path: '/v1/socket',
        auth: token ? { token } : {},
        transports: ['websocket'],
      });
      sockets.push(socket);
      return new Promise((resolve) =>
        socket.on('connect', () => setTimeout(() => resolve(socket), 100)),
      );
    }
    const next = (socket: Socket, event: string) =>
      new Promise<Record<string, unknown>>((resolve) => socket.once(event, resolve));

    it('refuses a socket without a valid token', async () => {
      const socket = io(baseUrl, {
        path: '/v1/socket',
        auth: { token: 'nonsense' },
        transports: ['websocket'],
      });
      sockets.push(socket);
      await new Promise<void>((resolve) => socket.on('disconnect', () => resolve()));
    });

    it('tells the driver about a request, and the client about each step and the location', async () => {
      const driver = await trips.approvedDriver();
      const client = await trips.clientWithCar();
      const driverSocket = await connect(driver.accessToken);
      const clientSocket = await connect(client.accessToken);

      const offered = next(driverSocket, 'offer:new');
      const booking = await trips.accepted(client, driver);
      expect((await offered).offerId).toEqual(expect.any(String));

      const arrived = next(clientSocket, 'booking:changed');
      await post(`/trips/${booking.id}/arrived`, driver.accessToken).expect(200);
      expect(await arrived).toEqual({ bookingId: booking.id });

      const moved = next(clientSocket, 'trip:location');
      await post('/drivers/me/location', driver.accessToken, ON_THE_ROAD).expect(204);
      expect(await moved).toMatchObject({ bookingId: booking.id, ...ON_THE_ROAD });

      // Another client hears nothing about this trip.
      const stranger = await trips.clientWithCar();
      const strangerSocket = await connect(stranger.accessToken);
      let heard = false;
      strangerSocket.on('booking:changed', () => (heard = true));
      await post(`/trips/${booking.id}/pin`, driver.accessToken, { pin: booking.tripPin }).expect(
        200,
      );
      await new Promise((r) => setTimeout(r, 300));
      expect(heard).toBe(false);
    });
  });
});
