import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { canGoOnline, DriverStatus, LatLng, ShiftView, UploadTicket } from '@driva/shared';
import { Pool } from 'pg';
import { writeAudit } from '../common/audit';
import { inTransaction, PG_POOL } from '../database/database.module';
import { FILE_STORAGE, FileStorage } from '../storage/file-storage';
import { MatchingService } from './matching.service';

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const point = (at: LatLng) => [at.lng, at.lat];

/** Going online and offline, with a selfie at the start of every shift. */
@Injectable()
export class ShiftsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly matching: MatchingService,
  ) {}

  async view(driverId: string): Promise<ShiftView> {
    const { rows } = await this.pool.query<{
      status: DriverStatus;
      last_full_vetting_at: Date | null;
      started_at: Date | null;
      active_booking_id: string | null;
    }>(
      `SELECT d.status, d.last_full_vetting_at,
              (SELECT started_at FROM driver_shifts s WHERE s.driver_id = d.user_id AND s.ended_at IS NULL) AS started_at,
              (SELECT id FROM bookings b WHERE b.driver_id = d.user_id
                 AND b.status IN ('accepted', 'driver_arrived', 'in_progress') LIMIT 1) AS active_booking_id
       FROM drivers d WHERE d.user_id = $1`,
      [driverId],
    );
    const d = rows[0];
    return {
      online: !!d?.started_at,
      startedAt: d?.started_at?.toISOString() ?? null,
      canGoOnline:
        !!d &&
        canGoOnline({ status: d.status, lastFullVettingAt: d.last_full_vetting_at }, new Date()),
      activeBookingId: d?.active_booking_id ?? null,
    };
  }

  async selfieUpload(driverId: string, contentType: string): Promise<UploadTicket> {
    await this.requireCanGoOnline(driverId);
    return this.storage.createUpload(
      `drivers/${driverId}/shift/${randomUUID()}.${EXTENSIONS[contentType]}`,
      contentType,
    );
  }

  async start(driverId: string, selfieKey: string, at: LatLng): Promise<ShiftView> {
    await this.requireCanGoOnline(driverId);
    if (
      !selfieKey.startsWith(`drivers/${driverId}/shift/`) ||
      !(await this.storage.exists(selfieKey))
    ) {
      throw new BadRequestException('Take your shift selfie first');
    }
    await inTransaction(this.pool, async (db) => {
      const open = await db.query(
        `SELECT 1 FROM driver_shifts WHERE driver_id = $1 AND ended_at IS NULL`,
        [driverId],
      );
      if (open.rowCount) return;
      const shift = await db.query<{ id: string }>(
        `INSERT INTO driver_shifts (driver_id, selfie_key) VALUES ($1, $2) RETURNING id`,
        [driverId, selfieKey],
      );
      await db.query(
        `INSERT INTO driver_presence (driver_id, shift_id, location)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography)
         ON CONFLICT (driver_id) DO UPDATE SET shift_id = EXCLUDED.shift_id, location = EXCLUDED.location, updated_at = now()`,
        [driverId, shift.rows[0]!.id, ...point(at)],
      );
      await writeAudit(db, {
        actorId: driverId,
        action: 'driver.shift_started',
        entity: 'driver',
        entityId: driverId,
      });
    });
    return this.view(driverId);
  }

  async end(driverId: string): Promise<ShiftView> {
    const view = await this.view(driverId);
    if (view.activeBookingId)
      throw new ConflictException('Finish your current trip before going offline');
    await inTransaction(this.pool, async (db) => {
      await db.query(
        `UPDATE driver_shifts SET ended_at = now() WHERE driver_id = $1 AND ended_at IS NULL`,
        [driverId],
      );
      await db.query(`DELETE FROM driver_presence WHERE driver_id = $1`, [driverId]);
      // Pass any request on the screen to the next driver.
      const { rows } = await db.query<{ booking_id: string }>(
        `UPDATE booking_offers SET status = 'declined', responded_at = now()
         WHERE driver_id = $1 AND status = 'offered' RETURNING booking_id`,
        [driverId],
      );
      await writeAudit(db, {
        actorId: driverId,
        action: 'driver.shift_ended',
        entity: 'driver',
        entityId: driverId,
      });
      for (const r of rows) await this.matching.dispatch(db, r.booking_id);
    });
    return this.view(driverId);
  }

  async location(driverId: string, at: LatLng & { heading?: number }): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE driver_presence SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
         heading = $4, updated_at = now()
       WHERE driver_id = $1`,
      [driverId, ...point(at), at.heading ?? null],
    );
    if (!rowCount) throw new ConflictException('Go online first');
  }

  private async requireCanGoOnline(driverId: string): Promise<void> {
    if (!(await this.view(driverId)).canGoOnline) {
      throw new ForbiddenException(
        'Only approved drivers with vetting from the last 12 months can go online',
      );
    }
  }
}
