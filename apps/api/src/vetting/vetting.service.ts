import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminDriverView,
  CheckStatus,
  DriverDocumentKind,
  DriverStatus,
  FIELD_VISIT_STEPS,
  ParsedVettingResult,
  StaffMember,
  UploadTicket,
  VETTING_STEP_LABELS,
  VETTING_STEPS,
  VettingCheckView,
  VettingQueueItem,
  VettingStep,
} from '@driva/shared';
import { Pool, PoolClient } from 'pg';
import { AuthUser } from '../auth/decorators';
import { writeAudit } from '../common/audit';
import { FieldEncryption, maskTail } from '../crypto/field-encryption';
import { inTransaction, PG_POOL } from '../database/database.module';
import { FILE_STORAGE, FileStorage } from '../storage/file-storage';

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

interface CheckRow {
  id: string;
  driver_id: string;
  step: VettingStep;
  status: CheckStatus;
  round: number;
  officer_id: string | null;
  officer_name: string | null;
  scheduled_for: Date | null;
  completed_at: Date | null;
  result_note: string | null;
  evidence_keys: string[];
  lat: number | null;
  lng: number | null;
}

const CHECK_COLUMNS = `vc.id, vc.driver_id, vc.step, vc.status, vc.round, vc.officer_id, o.full_name AS officer_name,
  vc.scheduled_for, vc.completed_at, vc.result_note, vc.evidence_keys,
  ST_Y(vc.visit_location::geometry) AS lat, ST_X(vc.visit_location::geometry) AS lng`;

/** Checks from the driver's latest vetting round. */
const CURRENT_ROUND = `vc.round = (SELECT max(round) FROM vetting_checks x WHERE x.driver_id = vc.driver_id)`;

@Injectable()
export class VettingService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly crypto: FieldEncryption,
  ) {}

  /** Drivers waiting on VeriQuest, oldest application first. */
  async queue(): Promise<VettingQueueItem[]> {
    const { rows } = await this.pool.query<{
      driver_id: string;
      full_name: string;
      city: string | null;
      submitted_at: Date | null;
      checks: {
        step: VettingStep;
        status: CheckStatus;
        officer: string | null;
        scheduled_for: string | null;
      }[];
    }>(
      `SELECT d.user_id AS driver_id, u.full_name, c.name AS city, d.submitted_at,
              coalesce(json_agg(json_build_object('step', vc.step, 'status', vc.status,
                'officer', o.full_name, 'scheduled_for', vc.scheduled_for)) FILTER (WHERE vc.id IS NOT NULL), '[]') AS checks
       FROM drivers d
       JOIN users u ON u.id = d.user_id
       LEFT JOIN cities c ON c.id = d.city_id
       LEFT JOIN vetting_checks vc ON vc.driver_id = d.user_id AND ${CURRENT_ROUND}
       LEFT JOIN users o ON o.id = vc.officer_id
       WHERE d.status = 'in_vetting'
       GROUP BY d.user_id, u.full_name, c.name, d.submitted_at
       ORDER BY d.submitted_at NULLS LAST`,
    );
    return rows.map((r) => {
      const ordered = VETTING_STEPS.map((step) => r.checks.find((c) => c.step === step)).filter(
        (c): c is NonNullable<typeof c> => !!c,
      );
      const next = ordered.find((c) => c.status !== 'passed') ?? null;
      return {
        driverId: r.driver_id,
        fullName: r.full_name,
        city: r.city,
        submittedAt: r.submitted_at?.toISOString() ?? null,
        passed: ordered.filter((c) => c.status === 'passed').length,
        total: VETTING_STEPS.length,
        nextStep: next?.step ?? null,
        nextStepStatus: next?.status ?? null,
        officerName: next?.officer ?? null,
        scheduledFor: next?.scheduled_for ? new Date(next.scheduled_for).toISOString() : null,
      };
    });
  }

  /** Everything an officer needs. NIN and licence are masked; use reveal() to see them. */
  async driver(driverId: string): Promise<AdminDriverView> {
    const { rows } = await this.pool.query<{
      id: string;
      full_name: string;
      phone: string;
      status: DriverStatus;
      city: string | null;
      years_driving: string | null;
      nin_encrypted: Buffer | null;
      licence_number_encrypted: Buffer | null;
      home_address: string | null;
      submitted_at: Date | null;
      approved_at: Date | null;
      last_full_vetting_at: Date | null;
      vetting_fee_waived: boolean;
    }>(
      `SELECT d.user_id AS id, u.full_name, u.phone, d.status, c.name AS city, d.years_driving,
              d.nin_encrypted, d.licence_number_encrypted, d.home_address, d.submitted_at,
              d.approved_at, d.last_full_vetting_at, d.vetting_fee_waived
       FROM drivers d JOIN users u ON u.id = d.user_id LEFT JOIN cities c ON c.id = d.city_id
       WHERE d.user_id = $1`,
      [driverId],
    );
    const d = rows[0];
    if (!d) throw new NotFoundException('Driver not found');

    const [guarantors, documents, consents, checks] = await Promise.all([
      this.pool.query(
        `SELECT slot, full_name, phone, relationship, address FROM guarantors WHERE driver_id = $1 ORDER BY slot`,
        [driverId],
      ),
      this.pool.query<{ kind: DriverDocumentKind; storage_key: string; created_at: Date }>(
        `SELECT kind, storage_key, created_at FROM driver_documents WHERE driver_id = $1 ORDER BY kind`,
        [driverId],
      ),
      this.pool.query<{ kind: string; accepted_at: Date }>(
        `SELECT kind, accepted_at FROM driver_consents WHERE driver_id = $1 ORDER BY kind`,
        [driverId],
      ),
      this.pool.query<CheckRow>(
        `SELECT ${CHECK_COLUMNS} FROM vetting_checks vc LEFT JOIN users o ON o.id = vc.officer_id
         WHERE vc.driver_id = $1 AND ${CURRENT_ROUND}`,
        [driverId],
      ),
    ]);

    return {
      id: d.id,
      fullName: d.full_name,
      phone: d.phone,
      status: d.status,
      city: d.city,
      yearsDriving: d.years_driving,
      ninMasked: d.nin_encrypted ? maskTail(this.crypto.decrypt(d.nin_encrypted)) : null,
      licenceMasked: d.licence_number_encrypted
        ? maskTail(this.crypto.decrypt(d.licence_number_encrypted))
        : null,
      homeAddress: d.home_address,
      submittedAt: d.submitted_at?.toISOString() ?? null,
      approvedAt: d.approved_at?.toISOString() ?? null,
      lastFullVettingAt: d.last_full_vetting_at?.toISOString() ?? null,
      vettingFeeWaived: d.vetting_fee_waived,
      guarantors: guarantors.rows.map((g) => ({
        slot: g.slot,
        fullName: g.full_name,
        phone: g.phone,
        relationship: g.relationship,
        address: g.address,
      })),
      documents: await Promise.all(
        documents.rows.map(async (doc) => ({
          kind: doc.kind,
          url: await this.storage.createDownloadUrl(doc.storage_key),
          uploadedAt: doc.created_at.toISOString(),
        })),
      ),
      consents: consents.rows.map((c) => ({
        kind: c.kind,
        acceptedAt: c.accepted_at.toISOString(),
      })),
      checks: await Promise.all(
        VETTING_STEPS.map((step) => checks.rows.find((c) => c.step === step))
          .filter((c): c is CheckRow => !!c)
          .map((c) => this.checkView(c)),
      ),
    };
  }

  /** Shows a full NIN or licence number to staff. Every view is audited. */
  async reveal(
    actor: AuthUser,
    driverId: string,
    field: 'nin' | 'licenceNumber',
  ): Promise<{ value: string }> {
    const column = field === 'nin' ? 'nin_encrypted' : 'licence_number_encrypted';
    const { rows } = await this.pool.query<{ value: Buffer | null }>(
      `SELECT ${column} AS value FROM drivers WHERE user_id = $1`,
      [driverId],
    );
    const stored = rows[0]?.value;
    if (!stored) throw new NotFoundException('Not recorded for this driver');
    await writeAudit(this.pool, {
      actorId: actor.id,
      action: 'driver.sensitive_viewed',
      entity: 'driver',
      entityId: driverId,
      details: { field },
    });
    return { value: this.crypto.decrypt(stored) };
  }

  async staff(): Promise<StaffMember[]> {
    const { rows } = await this.pool.query<{
      id: string;
      full_name: string;
      role: StaffMember['role'];
    }>(
      `SELECT id, full_name, role FROM users
       WHERE role IN ('admin', 'vetting_officer') AND deleted_at IS NULL ORDER BY full_name`,
    );
    return rows.map((r) => ({ id: r.id, fullName: r.full_name, role: r.role }));
  }

  /** Gives a check to an officer, with an optional visit time. */
  async assign(
    actor: AuthUser,
    checkId: string,
    officerId: string,
    scheduledFor?: string,
  ): Promise<VettingCheckView> {
    return inTransaction(this.pool, async (db) => {
      const check = await this.lockOpenCheck(db, checkId);
      const officer = await db.query(
        `SELECT 1 FROM users WHERE id = $1 AND role IN ('admin', 'vetting_officer') AND deleted_at IS NULL`,
        [officerId],
      );
      if (!officer.rowCount) throw new BadRequestException('Choose a VeriQuest officer');
      await db.query(
        `UPDATE vetting_checks SET officer_id = $2, scheduled_for = $3, status = 'in_progress' WHERE id = $1`,
        [checkId, officerId, scheduledFor ?? null],
      );
      await writeAudit(db, {
        actorId: actor.id,
        action: 'vetting.assigned',
        entity: 'vetting_check',
        entityId: checkId,
        details: {
          driverId: check.driver_id,
          step: check.step,
          officerId,
          scheduledFor: scheduledFor ?? null,
        },
      });
      return this.checkView(await this.loadCheck(db, checkId));
    });
  }

  /** Upload link for evidence photos on a check. */
  async evidenceUpload(checkId: string, contentType: string): Promise<UploadTicket> {
    await inTransaction(this.pool, (db) => this.lockOpenCheck(db, checkId));
    return this.storage.createUpload(
      `vetting/${checkId}/${randomUUID()}.${EXTENSIONS[contentType]}`,
      contentType,
    );
  }

  /**
   * Records a check result. A failed check rejects the driver. Passing the final review approves
   * them, but only when every other check in the round has passed.
   */
  async recordResult(
    actor: AuthUser,
    checkId: string,
    result: ParsedVettingResult & { vettingFeeWaived?: boolean },
  ): Promise<AdminDriverView> {
    if (result.vettingFeeWaived !== undefined && actor.role !== 'admin') {
      throw new ForbiddenException('Only an admin can waive the vetting fee');
    }
    const driverId = await inTransaction(this.pool, async (db) => {
      const check = await this.lockOpenCheck(db, checkId);
      const evidence = result.evidenceKeys ?? [];
      for (const key of evidence) {
        if (!key.startsWith(`vetting/${checkId}/`) || !(await this.storage.exists(key))) {
          throw new BadRequestException('An evidence photo is missing or belongs to another check');
        }
      }
      if (result.status === 'passed' && FIELD_VISIT_STEPS.includes(check.step)) {
        if (!evidence.length || !result.visitLocation) {
          throw new BadRequestException(
            'A visit can only pass with at least one photo and the GPS location of the visit',
          );
        }
      }
      if (result.status === 'passed' && check.step === 'final_review') {
        const open = await db.query<{ step: VettingStep }>(
          `SELECT step FROM vetting_checks
           WHERE driver_id = $1 AND round = $2 AND step <> 'final_review' AND status <> 'passed'`,
          [check.driver_id, check.round],
        );
        if (open.rowCount) {
          throw new ConflictException(
            `These checks must pass first: ${open.rows.map((r) => VETTING_STEP_LABELS[r.step]).join(', ')}`,
          );
        }
      }

      await db.query(
        `UPDATE vetting_checks SET status = $2, completed_at = now(), result_note = $3, evidence_keys = $4,
           visit_location = CASE WHEN $5::float8 IS NULL THEN NULL
                                 ELSE ST_SetSRID(ST_MakePoint($6::float8, $5::float8), 4326)::geography END,
           officer_id = coalesce(officer_id, $7)
         WHERE id = $1`,
        [
          checkId,
          result.status,
          result.note ?? null,
          evidence,
          result.visitLocation?.lat ?? null,
          result.visitLocation?.lng ?? null,
          actor.id,
        ],
      );
      // The note can hold sensitive findings, so the audit records only that one was written.
      await writeAudit(db, {
        actorId: actor.id,
        action: 'vetting.result',
        entity: 'vetting_check',
        entityId: checkId,
        details: {
          driverId: check.driver_id,
          step: check.step,
          round: check.round,
          status: result.status,
          hasNote: !!result.note,
          evidenceCount: evidence.length,
        },
      });

      if (result.status === 'failed') {
        await db.query(`UPDATE drivers SET status = 'rejected' WHERE user_id = $1`, [
          check.driver_id,
        ]);
        await writeAudit(db, {
          actorId: actor.id,
          action: 'driver.rejected',
          entity: 'driver',
          entityId: check.driver_id,
          details: { step: check.step, round: check.round },
        });
      } else if (check.step === 'final_review') {
        // approved_at is only set the first time: it starts the 15% commission year.
        const approved = await db.query<{ vetting_fee_waived: boolean }>(
          `UPDATE drivers SET status = 'approved', approved_at = coalesce(approved_at, now()),
             last_full_vetting_at = now(), vetting_fee_waived = coalesce($2, vetting_fee_waived)
           WHERE user_id = $1 RETURNING vetting_fee_waived`,
          [check.driver_id, result.vettingFeeWaived ?? null],
        );
        await writeAudit(db, {
          actorId: actor.id,
          action: 'driver.approved',
          entity: 'driver',
          entityId: check.driver_id,
          details: { round: check.round, vettingFeeWaived: approved.rows[0]?.vetting_fee_waived },
        });
      }
      return check.driver_id;
    });
    return this.driver(driverId);
  }

  /** POST /admin/drivers/:id/approve: passes the final review of the current round. */
  async approve(
    actor: AuthUser,
    driverId: string,
    body: { note?: string; vettingFeeWaived?: boolean },
  ): Promise<AdminDriverView> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT vc.id FROM vetting_checks vc
       WHERE vc.driver_id = $1 AND vc.step = 'final_review' AND ${CURRENT_ROUND}`,
      [driverId],
    );
    if (!rows[0]) throw new NotFoundException('This driver has not been sent for vetting');
    return this.recordResult(actor, rows[0].id, { status: 'passed', ...body });
  }

  /** Locks a check that can still change: driver in vetting, latest round, no result yet. */
  private async lockOpenCheck(db: PoolClient, checkId: string): Promise<CheckRow> {
    const { rows } = await db.query<
      CheckRow & { driver_status: DriverStatus; latest_round: number }
    >(
      `SELECT vc.id, vc.driver_id, vc.step, vc.status, vc.round, d.status AS driver_status,
              (SELECT max(round) FROM vetting_checks x WHERE x.driver_id = vc.driver_id) AS latest_round
       FROM vetting_checks vc JOIN drivers d ON d.user_id = vc.driver_id
       WHERE vc.id = $1
       FOR UPDATE OF vc, d`,
      [checkId],
    );
    const check = rows[0];
    if (!check) throw new NotFoundException('Check not found');
    if (check.driver_status !== 'in_vetting') {
      throw new ConflictException(
        `This driver is ${check.driver_status.replace('_', ' ')}, not in vetting`,
      );
    }
    if (check.round !== check.latest_round)
      throw new ConflictException('This check is from an old round');
    if (check.status === 'passed' || check.status === 'failed') {
      throw new ConflictException('This check already has a result');
    }
    return check;
  }

  private async loadCheck(db: PoolClient, checkId: string): Promise<CheckRow> {
    const { rows } = await db.query<CheckRow>(
      `SELECT ${CHECK_COLUMNS} FROM vetting_checks vc LEFT JOIN users o ON o.id = vc.officer_id WHERE vc.id = $1`,
      [checkId],
    );
    return rows[0]!;
  }

  private async checkView(c: CheckRow): Promise<VettingCheckView> {
    return {
      id: c.id,
      step: c.step,
      status: c.status,
      round: c.round,
      officerId: c.officer_id,
      officerName: c.officer_name,
      scheduledFor: c.scheduled_for?.toISOString() ?? null,
      completedAt: c.completed_at?.toISOString() ?? null,
      resultNote: c.result_note,
      evidence: await Promise.all(
        c.evidence_keys.map(async (key) => ({
          key,
          url: await this.storage.createDownloadUrl(key),
        })),
      ),
      visitLocation: c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : null,
    };
  }
}
