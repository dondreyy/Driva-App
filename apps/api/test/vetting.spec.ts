import { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
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

describeDb('Driver registration and vetting', () => {
  let app: INestApplication;
  let server: App;
  let pool: Pool;
  let flows: Flows;
  let lagosId: string;
  let officer: { id: string; accessToken: string };
  let admin: { id: string; accessToken: string };
  const sms = new FakeSms();

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await clearTestUsers(pool);
    app = await createTestApp(sms);
    server = app.getHttpServer();
    flows = new Flows(server, pool, sms);
    lagosId = (await pool.query(`SELECT id FROM cities WHERE name = 'Lagos'`)).rows[0].id;
    officer = await flows.staff(testPhone(), 'vetting_officer', 'Ada Obi');
    admin = await flows.staff(testPhone(), 'admin', 'Kunle Bello');
  });

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  let ninSeq = 0;
  /** An 11 digit NIN that is unique per test run. */
  const nin = () => `9${String(Date.now()).slice(-7)}${String(ninSeq++).padStart(3, '0')}`;

  const guarantors = () => ({
    guarantors: [
      {
        fullName: 'Ngozi Eze',
        phone: testPhone(),
        relationship: 'Former employer, pharmacist',
        address: '12 Admiralty Way',
      },
      {
        fullName: 'Musa Danjuma',
        phone: testPhone(),
        relationship: 'Uncle, civil servant',
        address: '3 Bourdillon Road',
      },
    ],
    confirmRules: true,
  });

  /** Uploads a photo the way the app does: ask for a link, PUT the bytes, then record it. */
  async function uploadDocument(token: string, kind: string) {
    const ticket = await request(server)
      .post(`/v1/drivers/me/documents/${kind}/upload`)
      .set(as(token))
      .send({ contentType: 'image/jpeg' })
      .expect(200);
    await request(server)
      .put(new URL(ticket.body.url).pathname)
      .set('Content-Type', 'image/jpeg')
      .send(JPEG)
      .expect(200);
    return request(server)
      .put(`/v1/drivers/me/documents/${kind}`)
      .set(as(token))
      .send({ key: ticket.body.key });
  }

  /** A driver who has filled in everything and sent the application. */
  async function submittedDriver() {
    const { accessToken, user } = await flows.signUp(testPhone(), 'driver', 'Emeka Okafor');
    const auth = as(accessToken);
    await request(server)
      .put('/v1/drivers/me/profile')
      .set(auth)
      .send({
        cityId: lagosId,
        nin: nin(),
        licenceNumber: 'ABC12345AA12',
        yearsDriving: '8 years or more',
      })
      .expect(200);
    for (const kind of ['licence', 'nin', 'passport_photo', 'selfie']) {
      expect((await uploadDocument(accessToken, kind)).status).toBe(200);
    }
    await request(server)
      .put('/v1/drivers/me/home')
      .set(auth)
      .send({ homeAddress: '4 Glover Road, Ikoyi' })
      .expect(200);
    await request(server).put('/v1/drivers/me/guarantors').set(auth).send(guarantors()).expect(200);
    await request(server)
      .put('/v1/drivers/me/consents')
      .set(auth)
      .send({ homeVisit: true, guarantorVisits: true, idAndCriminalChecks: true })
      .expect(200);
    const res = await request(server).post('/v1/drivers/me/submit').set(auth).expect(200);
    return { accessToken, driverId: user.id, application: res.body };
  }

  async function checksFor(driverId: string) {
    const res = await request(server)
      .get(`/v1/admin/drivers/${driverId}`)
      .set(as(officer.accessToken))
      .expect(200);
    return Object.fromEntries(
      res.body.checks.map((c: { step: string; id: string }) => [c.step, c.id]),
    );
  }

  async function evidence(checkId: string) {
    const ticket = await request(server)
      .post(`/v1/admin/vetting/${checkId}/evidence`)
      .set(as(officer.accessToken))
      .send({ contentType: 'image/jpeg' })
      .expect(200);
    await request(server)
      .put(new URL(ticket.body.url).pathname)
      .set('Content-Type', 'image/jpeg')
      .send(JPEG)
      .expect(200);
    return ticket.body.key as string;
  }

  const VISIT = { lat: 6.4474, lng: 3.4553 };

  async function pass(checkId: string, step: string, token = officer.accessToken) {
    const field = ['home_visit', 'guarantor_visit_1', 'guarantor_visit_2'].includes(step);
    // Upload first: a supertest request must not wait on other requests once created.
    const body = field
      ? { status: 'passed', evidenceKeys: [await evidence(checkId)], visitLocation: VISIT }
      : { status: 'passed' };
    return request(server).post(`/v1/admin/vetting/${checkId}/result`).set(as(token)).send(body);
  }

  describe('registration', () => {
    it('lists live cities for sign up', async () => {
      const res = await request(server).get('/v1/cities').expect(200);
      expect(res.body).toContainEqual({ id: lagosId, name: 'Lagos' });
    });

    it('starts empty and is only open to drivers', async () => {
      const driver = await flows.signUp(testPhone(), 'driver');
      const res = await request(server)
        .get('/v1/drivers/me')
        .set(as(driver.accessToken))
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'not_started',
        hasProfile: false,
        canGoOnline: false,
      });

      const client = await flows.signUp(testPhone(), 'client');
      await request(server).get('/v1/drivers/me').set(as(client.accessToken)).expect(403);
    });

    it('stores the NIN and licence encrypted, and refuses a NIN already registered', async () => {
      const first = await flows.signUp(testPhone(), 'driver');
      const value = nin();
      await request(server)
        .put('/v1/drivers/me/profile')
        .set(as(first.accessToken))
        .send({
          cityId: lagosId,
          nin: value,
          licenceNumber: 'LAG-55555-XY',
          yearsDriving: '4 to 7 years',
        })
        .expect(200);
      const row = await pool.query(
        `SELECT nin_encrypted, licence_number_encrypted FROM drivers WHERE user_id = $1`,
        [first.user.id],
      );
      expect(row.rows[0].nin_encrypted.toString('latin1')).not.toContain(value);
      expect(row.rows[0].licence_number_encrypted.toString('latin1')).not.toContain('LAG55555XY');

      const second = await flows.signUp(testPhone(), 'driver');
      const dup = await request(server)
        .put('/v1/drivers/me/profile')
        .set(as(second.accessToken))
        .send({
          cityId: lagosId,
          nin: value,
          licenceNumber: 'LAG66666XY',
          yearsDriving: '4 to 7 years',
        })
        .expect(409);
      expect(dup.body.message).toMatch(/already registered/);
    });

    it('validates the profile', async () => {
      const { accessToken } = await flows.signUp(testPhone(), 'driver');
      await request(server)
        .put('/v1/drivers/me/profile')
        .set(as(accessToken))
        .send({
          cityId: lagosId,
          nin: '1234',
          licenceNumber: 'ABC12345AA12',
          yearsDriving: '4 to 7 years',
        })
        .expect(400);
      const abuja = await pool.query(
        `INSERT INTO cities (name, is_live) VALUES ('Test City ' || gen_random_uuid(), false) RETURNING id`,
      );
      const res = await request(server)
        .put('/v1/drivers/me/profile')
        .set(as(accessToken))
        .send({
          cityId: abuja.rows[0].id,
          nin: nin(),
          licenceNumber: 'ABC12345AA12',
          yearsDriving: '4 to 7 years',
        })
        .expect(400);
      expect(res.body.message).toMatch(/not taking drivers/);
      await pool.query(`DELETE FROM cities WHERE id = $1`, [abuja.rows[0].id]);
    });

    it('lists what is missing before the application can be sent', async () => {
      const { accessToken } = await flows.signUp(testPhone(), 'driver');
      await request(server)
        .put('/v1/drivers/me/profile')
        .set(as(accessToken))
        .send({
          cityId: lagosId,
          nin: nin(),
          licenceNumber: 'ABC12345AA12',
          yearsDriving: '4 to 7 years',
        })
        .expect(200);
      const res = await request(server)
        .post('/v1/drivers/me/submit')
        .set(as(accessToken))
        .expect(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          'Missing: Driving licence',
          'Missing: Two guarantors',
          'Missing: Your consent to the checks',
        ]),
      );
    });

    it('only records uploads that belong to the driver and actually arrived', async () => {
      const a = await flows.signUp(testPhone(), 'driver');
      const b = await flows.signUp(testPhone(), 'driver');
      for (const d of [a, b]) {
        await request(server)
          .put('/v1/drivers/me/profile')
          .set(as(d.accessToken))
          .send({
            cityId: lagosId,
            nin: nin(),
            licenceNumber: 'ABC12345AA12',
            yearsDriving: '4 to 7 years',
          })
          .expect(200);
      }
      // A link that was issued but never used.
      const ticket = await request(server)
        .post('/v1/drivers/me/documents/licence/upload')
        .set(as(a.accessToken))
        .send({ contentType: 'image/jpeg' })
        .expect(200);
      await request(server)
        .put('/v1/drivers/me/documents/licence')
        .set(as(a.accessToken))
        .send({ key: ticket.body.key })
        .expect(400);
      // Someone else's key.
      await request(server)
        .put('/v1/drivers/me/documents/licence')
        .set(as(b.accessToken))
        .send({ key: ticket.body.key })
        .expect(400);
      // The wrong content type for the link, and a forged link.
      const path = new URL(ticket.body.url).pathname;
      await request(server).put(path).set('Content-Type', 'image/png').send(JPEG).expect(403);
      await request(server)
        .put(`${path}x`)
        .set('Content-Type', 'image/jpeg')
        .send(JPEG)
        .expect(403);
      // Only photos.
      await request(server)
        .post('/v1/drivers/me/documents/licence/upload')
        .set(as(a.accessToken))
        .send({ contentType: 'application/pdf' })
        .expect(400);
      await request(server)
        .post('/v1/drivers/me/documents/passport/upload')
        .set(as(a.accessToken))
        .send({ contentType: 'image/jpeg' })
        .expect(400);
    });

    it('refuses the driver as their own guarantor', async () => {
      const phone = testPhone();
      const { accessToken } = await flows.signUp(phone, 'driver');
      await request(server)
        .put('/v1/drivers/me/profile')
        .set(as(accessToken))
        .send({
          cityId: lagosId,
          nin: nin(),
          licenceNumber: 'ABC12345AA12',
          yearsDriving: '4 to 7 years',
        })
        .expect(200);
      const body = guarantors();
      body.guarantors[0]!.phone = phone;
      await request(server)
        .put('/v1/drivers/me/guarantors')
        .set(as(accessToken))
        .send(body)
        .expect(400);
    });

    it('sends a complete application for vetting and then locks it', async () => {
      const { accessToken, driverId, application } = await submittedDriver();
      expect(application).toMatchObject({
        status: 'in_vetting',
        canGoOnline: false,
        consentsGiven: true,
      });
      expect(application.vetting).toHaveLength(6);
      expect(application.vetting.every((c: { status: string }) => c.status === 'pending')).toBe(
        true,
      );
      await request(server)
        .put('/v1/drivers/me/home')
        .set(as(accessToken))
        .send({ homeAddress: 'Somewhere else' })
        .expect(409);
      const audit = await pool.query(
        `SELECT action FROM audit_log WHERE entity_id = $1 AND action IN ('driver.consent_given', 'driver.submitted')`,
        [driverId],
      );
      expect(audit.rows.map((r) => r.action).sort()).toEqual([
        'driver.consent_given',
        'driver.submitted',
      ]);
    });
  });

  describe('admin dashboard', () => {
    it('signs in staff only, and never lets staff sign up', async () => {
      const stranger = testPhone();
      const code = await flows.requestCode(stranger);
      const res = await request(server)
        .post('/v1/auth/otp/verify')
        .send({ phone: stranger, code, app: 'admin' })
        .expect(403);
      expect(res.body.message).toMatch(/no staff account/);

      const driver = testPhone();
      await flows.signUp(driver, 'driver');
      const driverCode = await flows.requestCode(driver);
      await request(server)
        .post('/v1/auth/otp/verify')
        .send({ phone: driver, code: driverCode, app: 'admin' })
        .expect(403);
    });

    it('keeps drivers and clients out of the admin routes', async () => {
      const { accessToken } = await flows.signUp(testPhone(), 'driver');
      await request(server).get('/v1/admin/vetting/queue').set(as(accessToken)).expect(403);
    });

    it('shows the queue with the next step for each driver', async () => {
      const { driverId } = await submittedDriver();
      const res = await request(server)
        .get('/v1/admin/vetting/queue')
        .set(as(officer.accessToken))
        .expect(200);
      expect(res.body).toContainEqual(
        expect.objectContaining({
          driverId,
          fullName: 'Emeka Okafor',
          city: 'Lagos',
          passed: 0,
          total: 6,
          nextStep: 'documents',
        }),
      );
    });

    it('masks the NIN, reveals it on request and audits that', async () => {
      const { driverId } = await submittedDriver();
      const res = await request(server)
        .get(`/v1/admin/drivers/${driverId}`)
        .set(as(officer.accessToken))
        .expect(200);
      expect(res.body.ninMasked).toMatch(/^\*{8}\d{3}$/);
      expect(res.body.guarantors).toHaveLength(2);
      expect(res.body.documents.map((d: { kind: string }) => d.kind).sort()).toEqual([
        'licence',
        'nin',
        'passport_photo',
        'selfie',
      ]);

      // Documents open only through their signed link.
      const url = new URL(res.body.documents[0].url);
      await request(server).get(url.pathname).expect(200);
      await request(server)
        .get(`${url.pathname.slice(0, -2)}xx`)
        .expect(403);

      const reveal = await request(server)
        .post(`/v1/admin/drivers/${driverId}/reveal`)
        .set(as(officer.accessToken))
        .send({ field: 'nin' })
        .expect(200);
      expect(reveal.body.value).toMatch(/^\d{11}$/);
      expect(reveal.body.value.slice(-3)).toBe(res.body.ninMasked.slice(-3));
      const audit = await pool.query(
        `SELECT actor_id, details FROM audit_log WHERE action = 'driver.sensitive_viewed' AND entity_id = $1`,
        [driverId],
      );
      expect(audit.rows).toEqual([{ actor_id: officer.id, details: { field: 'nin' } }]);
    });

    it('needs photo evidence and a GPS location to pass a visit', async () => {
      const { driverId } = await submittedDriver();
      const checks = await checksFor(driverId);
      const bare = await request(server)
        .post(`/v1/admin/vetting/${checks.home_visit}/result`)
        .set(as(officer.accessToken))
        .send({ status: 'passed' })
        .expect(400);
      expect(bare.body.message).toMatch(/photo and the GPS location/);

      // Evidence uploaded for a different check does not count.
      const otherKey = await evidence(checks.guarantor_visit_1);
      await request(server)
        .post(`/v1/admin/vetting/${checks.home_visit}/result`)
        .set(as(officer.accessToken))
        .send({ status: 'passed', evidenceKeys: [otherKey], visitLocation: VISIT })
        .expect(400);

      const ok = await pass(checks.home_visit, 'home_visit');
      expect(ok.status).toBe(200);
      const view = ok.body.checks.find((c: { step: string }) => c.step === 'home_visit');
      expect(view).toMatchObject({ status: 'passed', officerId: officer.id, visitLocation: VISIT });
      expect(view.evidence).toHaveLength(1);
    });

    it('assigns a check to an officer with a visit time', async () => {
      const { driverId } = await submittedDriver();
      const checks = await checksFor(driverId);
      const res = await request(server)
        .post(`/v1/admin/vetting/${checks.home_visit}/assign`)
        .set(as(admin.accessToken))
        .send({ officerId: officer.id, scheduledFor: '2026-11-02T10:00:00+01:00' })
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'in_progress',
        officerName: 'Ada Obi',
        scheduledFor: '2026-11-02T09:00:00.000Z',
      });
      const { accessToken: clientToken, user } = await flows.signUp(testPhone(), 'client');
      void clientToken;
      await request(server)
        .post(`/v1/admin/vetting/${checks.documents}/assign`)
        .set(as(admin.accessToken))
        .send({ officerId: user.id })
        .expect(400);
    });

    it('only approves when every check has passed, then the driver can go online', async () => {
      const { driverId, accessToken } = await submittedDriver();
      const checks = await checksFor(driverId);

      const early = await request(server)
        .post(`/v1/admin/drivers/${driverId}/approve`)
        .set(as(officer.accessToken))
        .send({})
        .expect(409);
      expect(early.body.message).toMatch(/must pass first: Documents, NIN and licence, Home visit/);

      for (const step of [
        'documents',
        'home_visit',
        'guarantor_visit_1',
        'guarantor_visit_2',
        'criminal_record',
      ]) {
        expect((await pass(checks[step], step)).status).toBe(200);
      }
      // Waiving the vetting fee is for admins only.
      await request(server)
        .post(`/v1/admin/drivers/${driverId}/approve`)
        .set(as(officer.accessToken))
        .send({ vettingFeeWaived: true })
        .expect(403);

      const approved = await request(server)
        .post(`/v1/admin/drivers/${driverId}/approve`)
        .set(as(officer.accessToken))
        .send({ note: 'All checks clear' })
        .expect(200);
      expect(approved.body).toMatchObject({ status: 'approved', vettingFeeWaived: false });
      expect(approved.body.approvedAt).toEqual(approved.body.lastFullVettingAt);

      const me = await request(server).get('/v1/drivers/me').set(as(accessToken)).expect(200);
      expect(me.body).toMatchObject({ status: 'approved', canGoOnline: true });
      expect(me.body.vetting.every((c: { status: string }) => c.status === 'passed')).toBe(true);

      // Approved drivers leave the queue, and nothing more can be recorded on the round.
      const queue = await request(server)
        .get('/v1/admin/vetting/queue')
        .set(as(officer.accessToken))
        .expect(200);
      expect(queue.body.map((q: { driverId: string }) => q.driverId)).not.toContain(driverId);
      await request(server)
        .post(`/v1/admin/vetting/${checks.documents}/result`)
        .set(as(officer.accessToken))
        .send({ status: 'failed', note: 'Changed my mind' })
        .expect(409);

      const audit = await pool.query(
        `SELECT actor_id, details FROM audit_log WHERE action = 'driver.approved' AND entity_id = $1`,
        [driverId],
      );
      expect(audit.rows).toEqual([
        { actor_id: officer.id, details: { round: 1, vettingFeeWaived: false } },
      ]);
      const results = await pool.query(
        `SELECT count(*)::int AS n FROM audit_log WHERE action = 'vetting.result' AND details->>'driverId' = $1`,
        [driverId],
      );
      expect(results.rows[0].n).toBe(6);
    });

    it('lets an admin approve a founding driver with the vetting fee waived', async () => {
      const { driverId } = await submittedDriver();
      const checks = await checksFor(driverId);
      for (const step of [
        'documents',
        'home_visit',
        'guarantor_visit_1',
        'guarantor_visit_2',
        'criminal_record',
      ]) {
        await pass(checks[step], step);
      }
      const res = await request(server)
        .post(`/v1/admin/drivers/${driverId}/approve`)
        .set(as(admin.accessToken))
        .send({ vettingFeeWaived: true })
        .expect(200);
      expect(res.body.vettingFeeWaived).toBe(true);
    });

    it('rejects the driver when a check fails, with a reason', async () => {
      const { driverId, accessToken } = await submittedDriver();
      const checks = await checksFor(driverId);
      await request(server)
        .post(`/v1/admin/vetting/${checks.guarantor_visit_2}/result`)
        .set(as(officer.accessToken))
        .send({ status: 'failed' })
        .expect(400);
      const res = await request(server)
        .post(`/v1/admin/vetting/${checks.guarantor_visit_2}/result`)
        .set(as(officer.accessToken))
        .send({ status: 'failed', note: 'Guarantor has known the driver for 6 months only' })
        .expect(200);
      expect(res.body.status).toBe('rejected');

      const me = await request(server).get('/v1/drivers/me').set(as(accessToken)).expect(200);
      expect(me.body).toMatchObject({ status: 'rejected', canGoOnline: false });
      // The officer's note is for staff only.
      expect(JSON.stringify(me.body)).not.toContain('6 months');
      // A rejected driver cannot be approved by finishing the other checks.
      await request(server)
        .post(`/v1/admin/drivers/${driverId}/approve`)
        .set(as(officer.accessToken))
        .send({})
        .expect(409);
      // The audit records that there was a note, not what it said.
      const audit = await pool.query(
        `SELECT details FROM audit_log WHERE action = 'vetting.result' AND entity_id = $1`,
        [checks.guarantor_visit_2],
      );
      expect(audit.rows[0].details).toMatchObject({ status: 'failed', hasNote: true });
      expect(JSON.stringify(audit.rows[0].details)).not.toContain('6 months');
    });
  });
});
