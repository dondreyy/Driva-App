import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canGoOnline,
  CheckStatus,
  VettingStep,
  DriverApplication,
  DriverDocumentKind,
  DriverStatus,
  missingForSubmission,
  ParsedDriverGuarantors,
  ParsedDriverProfile,
  UploadTicket,
  VETTING_STEPS,
} from '@driva/shared';
import { Pool, PoolClient } from 'pg';
import { writeAudit } from '../common/audit';
import { FieldEncryption } from '../crypto/field-encryption';
import { inTransaction, PG_POOL } from '../database/database.module';
import { FILE_STORAGE, FileStorage } from '../storage/file-storage';

const CONSENT_KINDS = ['home_visit', 'guarantor_visits', 'id_and_criminal_checks'] as const;
const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

@Injectable()
export class DriversService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly crypto: FieldEncryption,
  ) {}

  async getApplication(
    userId: string,
    db: Pool | PoolClient = this.pool,
  ): Promise<DriverApplication> {
    const { rows } = await db.query<{
      status: DriverStatus;
      city_id: string | null;
      has_profile: boolean;
      years_driving: string | null;
      home_address: string | null;
      guarantor_count: number;
      documents: DriverDocumentKind[];
      consent_count: number;
      submitted_at: Date | null;
      approved_at: Date | null;
      last_full_vetting_at: Date | null;
    }>(
      `SELECT d.status, d.city_id, d.nin_encrypted IS NOT NULL AS has_profile, d.years_driving,
              d.home_address, d.submitted_at, d.approved_at, d.last_full_vetting_at,
              (SELECT count(*)::int FROM guarantors g WHERE g.driver_id = d.user_id) AS guarantor_count,
              array(SELECT DISTINCT kind FROM driver_documents dd WHERE dd.driver_id = d.user_id) AS documents,
              (SELECT count(DISTINCT kind)::int FROM driver_consents c WHERE c.driver_id = d.user_id) AS consent_count
       FROM drivers d WHERE d.user_id = $1`,
      [userId],
    );
    const d = rows[0];
    if (!d) {
      return {
        status: 'not_started',
        cityId: null,
        hasProfile: false,
        yearsDriving: null,
        homeAddress: null,
        guarantorCount: 0,
        documents: [],
        consentsGiven: false,
        submittedAt: null,
        approvedAt: null,
        canGoOnline: false,
        vetting: [],
      };
    }
    const checks = await db.query<{ step: VettingStep; status: CheckStatus }>(
      `SELECT step, status FROM vetting_checks
       WHERE driver_id = $1 AND round = (SELECT max(round) FROM vetting_checks WHERE driver_id = $1)`,
      [userId],
    );
    return {
      status: d.status,
      cityId: d.city_id,
      hasProfile: d.has_profile,
      yearsDriving: d.years_driving,
      homeAddress: d.home_address,
      guarantorCount: d.guarantor_count,
      documents: d.documents,
      consentsGiven: d.consent_count === CONSENT_KINDS.length,
      submittedAt: d.submitted_at?.toISOString() ?? null,
      approvedAt: d.approved_at?.toISOString() ?? null,
      canGoOnline: canGoOnline(
        { status: d.status, lastFullVettingAt: d.last_full_vetting_at },
        new Date(),
      ),
      vetting: checks.rows.length
        ? VETTING_STEPS.map((step) => ({
            step,
            status: checks.rows.find((c) => c.step === step)?.status ?? 'pending',
          }))
        : [],
    };
  }

  /** NIN, licence, experience and city. Creates the driver record on first save. */
  async saveProfile(userId: string, body: ParsedDriverProfile): Promise<DriverApplication> {
    return inTransaction(this.pool, async (db) => {
      const city = await db.query(`SELECT 1 FROM cities WHERE id = $1 AND is_live`, [body.cityId]);
      if (!city.rowCount)
        throw new BadRequestException('Driva is not taking drivers in that city yet');
      await this.lockEditable(db, userId, { allowMissing: true });
      try {
        await db.query(
          `INSERT INTO drivers (user_id, city_id, nin_encrypted, nin_lookup_hash, licence_number_encrypted, years_driving)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id) DO UPDATE SET
             city_id = EXCLUDED.city_id, nin_encrypted = EXCLUDED.nin_encrypted,
             nin_lookup_hash = EXCLUDED.nin_lookup_hash,
             licence_number_encrypted = EXCLUDED.licence_number_encrypted,
             years_driving = EXCLUDED.years_driving`,
          [
            userId,
            body.cityId,
            this.crypto.encrypt(body.nin),
            this.crypto.lookupHash('nin', body.nin),
            this.crypto.encrypt(body.licenceNumber),
            body.yearsDriving,
          ],
        );
      } catch (err) {
        if ((err as { constraint?: string }).constraint === 'drivers_nin_lookup_hash_key') {
          throw new ConflictException(
            'This NIN is already registered with Driva. Contact support.',
          );
        }
        throw err;
      }
      return this.getApplication(userId, db);
    });
  }

  async saveHome(userId: string, homeAddress: string): Promise<DriverApplication> {
    return inTransaction(this.pool, async (db) => {
      await this.lockEditable(db, userId);
      await db.query(`UPDATE drivers SET home_address = $2 WHERE user_id = $1`, [
        userId,
        homeAddress,
      ]);
      return this.getApplication(userId, db);
    });
  }

  async saveGuarantors(userId: string, body: ParsedDriverGuarantors): Promise<DriverApplication> {
    return inTransaction(this.pool, async (db) => {
      await this.lockEditable(db, userId);
      const own = await db.query<{ phone: string }>(`SELECT phone FROM users WHERE id = $1`, [
        userId,
      ]);
      if (body.guarantors.some((g) => g.phone === own.rows[0]?.phone)) {
        throw new BadRequestException('A guarantor cannot be you');
      }
      await db.query(`DELETE FROM guarantors WHERE driver_id = $1`, [userId]);
      for (const [index, g] of body.guarantors.entries()) {
        await db.query(
          `INSERT INTO guarantors (driver_id, slot, full_name, phone, relationship, address)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [userId, index + 1, g.fullName, g.phone, g.relationship, g.address],
        );
      }
      return this.getApplication(userId, db);
    });
  }

  async createUpload(
    userId: string,
    kind: DriverDocumentKind,
    contentType: string,
  ): Promise<UploadTicket> {
    await inTransaction(this.pool, (db) => this.lockEditable(db, userId));
    const key = `drivers/${userId}/${kind}/${randomUUID()}.${EXTENSIONS[contentType]}`;
    return this.storage.createUpload(key, contentType);
  }

  /** Records an uploaded photo. The key must be one we issued to this driver for this kind. */
  async saveDocument(
    userId: string,
    kind: DriverDocumentKind,
    key: string,
  ): Promise<DriverApplication> {
    if (!key.startsWith(`drivers/${userId}/${kind}/`)) {
      throw new BadRequestException('That upload does not belong to this document');
    }
    if (!(await this.storage.exists(key))) {
      throw new BadRequestException('The photo has not finished uploading. Try again.');
    }
    return inTransaction(this.pool, async (db) => {
      await this.lockEditable(db, userId);
      await db.query(`DELETE FROM driver_documents WHERE driver_id = $1 AND kind = $2`, [
        userId,
        kind,
      ]);
      await db.query(
        `INSERT INTO driver_documents (driver_id, kind, storage_key) VALUES ($1, $2, $3)`,
        [userId, kind, key],
      );
      if (kind === 'selfie') {
        await db.query(`UPDATE drivers SET selfie_key = $2 WHERE user_id = $1`, [userId, key]);
      }
      return this.getApplication(userId, db);
    });
  }

  async saveConsents(userId: string): Promise<DriverApplication> {
    return inTransaction(this.pool, async (db) => {
      await this.lockEditable(db, userId);
      for (const kind of CONSENT_KINDS) {
        await db.query(
          `INSERT INTO driver_consents (driver_id, kind) VALUES ($1, $2) ON CONFLICT (driver_id, kind) DO NOTHING`,
          [userId, kind],
        );
      }
      await writeAudit(db, {
        actorId: userId,
        action: 'driver.consent_given',
        entity: 'driver',
        entityId: userId,
        details: { kinds: CONSENT_KINDS },
      });
      return this.getApplication(userId, db);
    });
  }

  /** Sends the finished application to VeriQuest and opens the vetting checks. */
  async submit(userId: string): Promise<DriverApplication> {
    return inTransaction(this.pool, async (db) => {
      await this.lockEditable(db, userId);
      const missing = missingForSubmission(await this.getApplication(userId, db));
      if (missing.length) {
        throw new BadRequestException(missing.map((m) => `Missing: ${m}`));
      }
      await db.query(
        `UPDATE drivers SET status = 'in_vetting', submitted_at = now() WHERE user_id = $1`,
        [userId],
      );
      for (const step of VETTING_STEPS) {
        await db.query(
          `INSERT INTO vetting_checks (driver_id, step, round) VALUES ($1, $2, 1)
           ON CONFLICT (driver_id, step, round) DO NOTHING`,
          [userId, step],
        );
      }
      await writeAudit(db, {
        actorId: userId,
        action: 'driver.submitted',
        entity: 'driver',
        entityId: userId,
        details: { round: 1 },
      });
      return this.getApplication(userId, db);
    });
  }

  /** The application can only change while it has not been sent for vetting. */
  private async lockEditable(
    db: PoolClient,
    userId: string,
    opts: { allowMissing?: boolean } = {},
  ) {
    const { rows } = await db.query<{ status: DriverStatus }>(
      `SELECT status FROM drivers WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    const status = rows[0]?.status;
    if (!status) {
      if (opts.allowMissing) return;
      throw new NotFoundException('Start with your NIN and licence details');
    }
    if (status !== 'applied') {
      throw new ConflictException(
        'Your application has been sent to VeriQuest. Contact Driva to change it.',
      );
    }
  }
}
