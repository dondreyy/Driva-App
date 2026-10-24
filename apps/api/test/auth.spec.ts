import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { Pool } from 'pg';
import request from 'supertest';
import {
  clearTestUsers,
  createTestApp,
  databaseUrl,
  describeDb,
  FakeSms,
  Flows,
  testPhone as nextPhone,
} from './helpers';

describeDb('Auth: OTP sign up and sign in', () => {
  let app: INestApplication;
  let server: App;
  let pool: Pool;
  let flows: Flows;
  const sms = new FakeSms();

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await clearTestUsers(pool);
    app = await createTestApp(sms);
    server = app.getHttpServer();
    flows = new Flows(server, pool, sms);
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  const requestCode = (phone: string) => flows.requestCode(phone);

  async function signUp(phone: string, app: 'client' | 'driver' = 'client') {
    const code = await requestCode(phone);
    const verify = await request(server)
      .post('/v1/auth/otp/verify')
      .send({ phone, code, app })
      .expect(200);
    expect(verify.body).toEqual({ status: 'signup_required', signupToken: expect.any(String) });
    const signup = await request(server)
      .post('/v1/auth/signup')
      .send({ signupToken: verify.body.signupToken, fullName: 'Tolu Adebayo', consent: true })
      .expect(201);
    return signup.body;
  }

  it('signs up a new client and returns tokens and the profile', async () => {
    const phone = nextPhone();
    const body = await signUp(phone);
    expect(body).toEqual({
      user: expect.objectContaining({ role: 'client', phone, fullName: 'Tolu Adebayo' }),
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresIn: 900,
    });

    const row = await pool.query(
      `SELECT phone_verified_at IS NOT NULL AS verified, consent_recorded_at IS NOT NULL AS consent
       FROM users WHERE phone = $1`,
      [phone],
    );
    expect(row.rows[0]).toEqual({ verified: true, consent: true });
    const audit = await pool.query(
      `SELECT details FROM audit_log WHERE action = 'user.signed_up' AND entity_id = $1`,
      [body.user.id],
    );
    expect(audit.rows[0].details).toEqual({ role: 'client', app: 'client', consent: true });

    const me = await request(server)
      .get('/v1/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ id: body.user.id, role: 'client' });
  });

  it('accepts the number however it is typed', async () => {
    const phone = nextPhone();
    const local = `0${phone.slice(4)}`; // +2349000123456 -> 09000123456
    await requestCode(phone);
    // Typed the local way it is the same number, so the 60 second wait applies to it.
    await request(server)
      .post('/v1/auth/otp/request')
      .send({ phone: `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}` })
      .expect(429);
    expect(sms.sent.at(-1)?.phone).toBe(phone);
  });

  it('signs up a driver from the driver app', async () => {
    const body = await signUp(nextPhone(), 'driver');
    expect(body.user.role).toBe('driver');
  });

  it('refuses sign up without consent', async () => {
    const phone = nextPhone();
    const code = await requestCode(phone);
    const verify = await request(server)
      .post('/v1/auth/otp/verify')
      .send({ phone, code, app: 'client' })
      .expect(200);
    await request(server)
      .post('/v1/auth/signup')
      .send({ signupToken: verify.body.signupToken, fullName: 'Tolu Adebayo', consent: false })
      .expect(400);
  });

  it('signs in an existing user with a new code', async () => {
    const phone = nextPhone();
    const { user } = await signUp(phone);
    const code = await requestCode(phone);
    const res = await request(server)
      .post('/v1/auth/otp/verify')
      .send({ phone, code, app: 'client' })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'signed_in', user: { id: user.id } });
  });

  it('keeps clients out of the driver app and drivers out of the client app', async () => {
    const client = nextPhone();
    await signUp(client, 'client');
    let code = await requestCode(client);
    const res = await request(server)
      .post('/v1/auth/otp/verify')
      .send({ phone: client, code, app: 'driver' })
      .expect(403);
    expect(res.body.message).toMatch(/client account/);

    const driver = nextPhone();
    await signUp(driver, 'driver');
    code = await requestCode(driver);
    await request(server)
      .post('/v1/auth/otp/verify')
      .send({ phone: driver, code, app: 'client' })
      .expect(403);
  });

  it('makes each code single use', async () => {
    const phone = nextPhone();
    const code = await requestCode(phone);
    await request(server)
      .post('/v1/auth/otp/verify')
      .send({ phone, code, app: 'client' })
      .expect(200);
    await request(server)
      .post('/v1/auth/otp/verify')
      .send({ phone, code, app: 'client' })
      .expect(400);
  });

  it('locks a code after 5 wrong guesses', async () => {
    const phone = nextPhone();
    const code = await requestCode(phone);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const res = await request(server)
        .post('/v1/auth/otp/verify')
        .send({ phone, code: wrong, app: 'client' })
        .expect(400);
      expect(res.body.message).toMatch(/not right/);
    }
    await request(server)
      .post('/v1/auth/otp/verify')
      .send({ phone, code, app: 'client' })
      .expect(429);
  });

  it('refuses an expired code', async () => {
    const phone = nextPhone();
    const code = await requestCode(phone);
    await pool.query(
      `UPDATE otp_codes SET expires_at = now() - interval '1 second' WHERE phone = $1`,
      [phone],
    );
    const res = await request(server)
      .post('/v1/auth/otp/verify')
      .send({ phone, code, app: 'client' })
      .expect(400);
    expect(res.body.message).toMatch(/expired/);
  });

  it('only accepts the newest code', async () => {
    const phone = nextPhone();
    const first = await requestCode(phone);
    const second = await requestCode(phone);
    if (first !== second) {
      await request(server)
        .post('/v1/auth/otp/verify')
        .send({ phone, code: first, app: 'client' })
        .expect(400);
    }
    await request(server)
      .post('/v1/auth/otp/verify')
      .send({ phone, code: second, app: 'client' })
      .expect(200);
  });

  it('makes a number wait 60 seconds between codes and caps it at 5 an hour', async () => {
    const phone = nextPhone();
    await requestCode(phone);
    const res = await request(server).post('/v1/auth/otp/request').send({ phone }).expect(429);
    expect(res.body.message).toMatch(/Wait \d+ seconds/);
    for (let i = 0; i < 4; i++) await requestCode(phone);
    await pool.query(
      `UPDATE otp_codes SET created_at = created_at - interval '2 minutes' WHERE phone = $1`,
      [phone],
    );
    const capped = await request(server).post('/v1/auth/otp/request').send({ phone }).expect(429);
    expect(capped.body.message).toMatch(/an hour/);
  });

  it('never stores the code itself', async () => {
    const phone = nextPhone();
    const code = await requestCode(phone);
    const { rows } = await pool.query(`SELECT code_hash FROM otp_codes WHERE phone = $1`, [phone]);
    expect(rows[0].code_hash).not.toContain(code);
    expect(rows[0].code_hash).toHaveLength(64);
  });

  it('rejects numbers that are not Nigerian mobiles and unknown fields', async () => {
    await request(server).post('/v1/auth/otp/request').send({ phone: '+447700900123' }).expect(400);
    await request(server)
      .post('/v1/auth/otp/request')
      .send({ phone: nextPhone(), role: 'admin' })
      .expect(400);
  });

  describe('sessions', () => {
    it('rotates refresh tokens and ends every session if an old one is reused', async () => {
      const first = await signUp(nextPhone());
      const second = await request(server)
        .post('/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);
      expect(second.body.refreshToken).not.toBe(first.refreshToken);

      // The first token was already used: treat it as stolen.
      await request(server)
        .post('/v1/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
      await request(server)
        .post('/v1/auth/refresh')
        .send({ refreshToken: second.body.refreshToken })
        .expect(401);
      const audit = await pool.query(
        `SELECT 1 FROM audit_log WHERE action = 'auth.refresh_token_reused' AND entity_id = $1`,
        [first.user.id],
      );
      // Both attempts are logged: the stolen token, then the one revoked because of it.
      expect(audit.rowCount).toBe(2);
    });

    it('refuses an expired refresh token', async () => {
      const { refreshToken, user } = await signUp(nextPhone());
      await pool.query(`UPDATE refresh_tokens SET expires_at = now() WHERE user_id = $1`, [
        user.id,
      ]);
      await request(server).post('/v1/auth/refresh').send({ refreshToken }).expect(401);
    });

    it('logs out by revoking the refresh token', async () => {
      const { refreshToken } = await signUp(nextPhone());
      await request(server).post('/v1/auth/logout').send({ refreshToken }).expect(204);
      await request(server).post('/v1/auth/refresh').send({ refreshToken }).expect(401);
    });

    it('stores only a hash of refresh tokens', async () => {
      const { refreshToken, user } = await signUp(nextPhone());
      const { rows } = await pool.query(
        `SELECT token_hash FROM refresh_tokens WHERE user_id = $1`,
        [user.id],
      );
      expect(rows[0].token_hash).not.toBe(refreshToken);
    });
  });

  describe('/me', () => {
    it('needs a valid access token', async () => {
      await request(server).get('/v1/me').expect(401);
      await request(server).get('/v1/me').set('Authorization', 'Bearer nonsense').expect(401);
    });

    it('does not accept a sign-up token as an access token', async () => {
      const phone = nextPhone();
      const code = await requestCode(phone);
      const verify = await request(server)
        .post('/v1/auth/otp/verify')
        .send({ phone, code, app: 'client' })
        .expect(200);
      await request(server)
        .get('/v1/me')
        .set('Authorization', `Bearer ${verify.body.signupToken}`)
        .expect(401);
    });

    it('updates the profile but never the role or phone', async () => {
      const { accessToken } = await signUp(nextPhone());
      const auth = { Authorization: `Bearer ${accessToken}` };
      const res = await request(server)
        .patch('/v1/me')
        .set(auth)
        .send({
          fullName: 'Tolu A. Adebayo',
          emergencyContactName: 'Bimpe Adebayo',
          emergencyContactPhone: '0807 555 0190',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        fullName: 'Tolu A. Adebayo',
        emergencyContactPhone: '+2348075550190',
      });
      await request(server).patch('/v1/me').set(auth).send({ role: 'admin' }).expect(400);
      await request(server).patch('/v1/me').set(auth).send({ phone: '+2348000000000' }).expect(400);
    });

    it('refuses a closed account', async () => {
      const phone = nextPhone();
      const { accessToken, user } = await signUp(phone);
      await pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [user.id]);
      await request(server).get('/v1/me').set('Authorization', `Bearer ${accessToken}`).expect(404);
      const code = await requestCode(phone);
      await request(server)
        .post('/v1/auth/otp/verify')
        .send({ phone, code, app: 'client' })
        .expect(403);
    });
  });

  it('limits sign in requests to 10 a minute from one address', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        statuses.push(
          (await request(server).post('/v1/auth/otp/request').send({ phone: 'x' })).status,
        );
      }
      expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
      expect(statuses[10]).toBe(429);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
