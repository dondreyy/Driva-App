import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingView,
  commissionBpsFor,
  DEFAULT_PRICING_RULE,
  PhotoPhase,
  PIN_LOCK_MINUTES,
  PIN_MAX_ATTEMPTS,
  SHARE_LINK_AFTER_TRIP_HOURS,
  splitFare,
  TrackView,
  TRIP_PHOTO_SHOTS,
  TripType,
  UploadTicket,
} from '@driva/shared';
import { Pool, PoolClient } from 'pg';
import { AuthUser } from '../auth/decorators';
import { LIVE_STATUSES, loadBookingView } from '../bookings/booking-view';
import { writeAudit } from '../common/audit';
import { APP_CONFIG, AppConfig } from '../config/config';
import { FieldEncryption } from '../crypto/field-encryption';
import { inTransaction, PG_POOL } from '../database/database.module';
import { EventsService } from '../events/events.service';
import { FILE_STORAGE, FileStorage } from '../storage/file-storage';

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };
/** A share link made before the trip ends lasts at most this long. */
const SHARE_LINK_MAX_HOURS = 24;

interface TripRow {
  id: string;
  status: string;
  trip_type: TripType;
  client_id: string;
  driver_id: string | null;
  trip_pin_encrypted: Buffer | null;
  pin_verified_at: Date | null;
  pin_attempts: number;
  pin_locked_for: number | null;
}

/** The trip from the driver's arrival to the end, for the driver who accepted it. */
@Injectable()
export class TripsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly crypto: FieldEncryption,
    private readonly events: EventsService,
  ) {}

  async arrived(driver: AuthUser, bookingId: string): Promise<BookingView> {
    return this.move(driver, bookingId, 'accepted', 'driver_arrived', 'arrived_at');
  }

  /**
   * The driver types the PIN the client reads out. The trip cannot start without it.
   * After 5 wrong tries, entry pauses for 5 minutes.
   */
  async checkPin(driver: AuthUser, bookingId: string, pin: string): Promise<BookingView> {
    const failure = await inTransaction(this.pool, async (db) => {
      const trip = await this.lock(db, driver, bookingId);
      if (trip.status !== 'driver_arrived') {
        return new ConflictException('Tap "I have arrived" before entering the PIN');
      }
      if (trip.pin_verified_at) return null;
      if (trip.pin_locked_for) {
        return new HttpException(
          `Too many wrong PINs. Try again in ${trip.pin_locked_for} minute${trip.pin_locked_for === 1 ? '' : 's'}.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const expected = this.crypto.decrypt(trip.trip_pin_encrypted!);
      if (safeEqual(expected, pin)) {
        await db.query(
          `UPDATE bookings SET pin_verified_at = now(), pin_attempts = 0 WHERE id = $1`,
          [bookingId],
        );
        await writeAudit(db, {
          actorId: driver.id,
          action: 'trip.pin_verified',
          entity: 'booking',
          entityId: bookingId,
        });
        return null;
      }
      const attempts = trip.pin_attempts + 1;
      const locked = attempts >= PIN_MAX_ATTEMPTS;
      await db.query(
        `UPDATE bookings SET pin_attempts = $2,
           pin_locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE pin_locked_until END
         WHERE id = $1`,
        [bookingId, locked ? 0 : attempts, locked, PIN_LOCK_MINUTES],
      );
      await writeAudit(db, {
        actorId: driver.id,
        action: 'trip.pin_failed',
        entity: 'booking',
        entityId: bookingId,
        details: { attempt: attempts, locked },
      });
      return locked
        ? new HttpException(
            `Too many wrong PINs. Try again in ${PIN_LOCK_MINUTES} minutes.`,
            HttpStatus.TOO_MANY_REQUESTS,
          )
        : new BadRequestException(
            `That PIN is not right. ${PIN_MAX_ATTEMPTS - attempts} tr${PIN_MAX_ATTEMPTS - attempts === 1 ? 'y' : 'ies'} left.`,
          );
    });
    // Thrown after commit so wrong tries are counted.
    if (failure) throw failure;
    return this.viewAndTell(driver, bookingId);
  }

  /** Drive my car alone: five photos at handover and five at return. */
  async photoUpload(
    driver: AuthUser,
    bookingId: string,
    phase: PhotoPhase,
    shot: string,
    contentType: string,
  ): Promise<UploadTicket> {
    await inTransaction(this.pool, async (db) =>
      this.requirePhotoPhase(await this.lock(db, driver, bookingId), phase),
    );
    return this.storage.createUpload(
      `bookings/${bookingId}/${phase}/${shot}-${randomUUID()}.${EXTENSIONS[contentType]}`,
      contentType,
    );
  }

  async savePhoto(
    driver: AuthUser,
    bookingId: string,
    body: { phase: PhotoPhase; shot: string; key: string; lat?: number; lng?: number },
  ): Promise<BookingView> {
    if (!body.key.startsWith(`bookings/${bookingId}/${body.phase}/${body.shot}-`)) {
      throw new BadRequestException('That upload does not belong to this photo');
    }
    if (!(await this.storage.exists(body.key))) {
      throw new BadRequestException('The photo has not finished uploading. Try again.');
    }
    await inTransaction(this.pool, async (db) => {
      this.requirePhotoPhase(await this.lock(db, driver, bookingId), body.phase);
      await db.query(
        `INSERT INTO trip_photos (booking_id, phase, shot, storage_key, location)
         VALUES ($1, $2, $3, $4,
           CASE WHEN $5::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography END)
         ON CONFLICT (booking_id, phase, shot) DO UPDATE
           SET storage_key = EXCLUDED.storage_key, location = EXCLUDED.location, taken_at = now()`,
        [bookingId, body.phase, body.shot, body.key, body.lat ?? null, body.lng ?? null],
      );
    });
    return this.viewAndTell(driver, bookingId);
  }

  /** Needs the client's PIN, and for Drive my car alone all five handover photos. */
  async start(driver: AuthUser, bookingId: string): Promise<BookingView> {
    return this.move(
      driver,
      bookingId,
      'driver_arrived',
      'in_progress',
      'started_at',
      async (db, trip) => {
        if (!trip.pin_verified_at) throw new ConflictException('Enter the client’s PIN first');
        if (trip.trip_type === 'drive_alone') await this.requireAllPhotos(db, bookingId, 'before');
      },
    );
  }

  /**
   * Ends the trip. Driva's commission is worked out at the driver's own rate today and stored
   * on the trip with what the driver earns. The fare itself never changes.
   */
  async end(driver: AuthUser, bookingId: string): Promise<BookingView> {
    return this.move(
      driver,
      bookingId,
      'in_progress',
      'completed',
      'ended_at',
      async (db, trip) => {
        if (trip.trip_type === 'drive_alone') await this.requireAllPhotos(db, bookingId, 'after');
        const { rows } = await db.query<{
          total_fare_kobo: string;
          approved_at: Date;
          first_year_bps: number | null;
          after_bps: number | null;
        }>(
          `SELECT b.total_fare_kobo, d.approved_at,
                r.commission_first_year_bps AS first_year_bps, r.commission_after_bps AS after_bps
         FROM bookings b
         JOIN drivers d ON d.user_id = b.driver_id
         LEFT JOIN quotes q ON q.id = b.quote_id
         LEFT JOIN pricing_rules r ON r.id = q.pricing_rule_id
         WHERE b.id = $1`,
          [bookingId],
        );
        const r = rows[0]!;
        const bps = commissionBpsFor(r.approved_at, new Date(), {
          ...DEFAULT_PRICING_RULE,
          commissionFirstYearBps: r.first_year_bps ?? DEFAULT_PRICING_RULE.commissionFirstYearBps,
          commissionAfterBps: r.after_bps ?? DEFAULT_PRICING_RULE.commissionAfterBps,
        });
        const split = splitFare(Number(r.total_fare_kobo), bps);
        await db.query(
          `UPDATE bookings SET commission_bps = $2, commission_kobo = $3, driver_earning_kobo = $4 WHERE id = $1`,
          [bookingId, bps, split.commissionKobo, split.driverEarningKobo],
        );
        // Share links stop shortly after the trip.
        await db.query(
          `UPDATE trip_share_links SET expires_at = least(expires_at, now() + make_interval(hours => $2))
         WHERE booking_id = $1`,
          [bookingId, SHARE_LINK_AFTER_TRIP_HOURS],
        );
        return {
          totalFareKobo: Number(r.total_fare_kobo),
          commissionBps: bps,
          commissionKobo: split.commissionKobo,
          driverEarningKobo: split.driverEarningKobo,
        };
      },
    );
  }

  /** A link anyone can open to follow the trip live, made by the client. */
  async share(client: AuthUser, bookingId: string): Promise<{ url: string; expiresAt: string }> {
    const token = randomBytes(24).toString('base64url');
    const { rows } = await this.pool.query<{ expires_at: Date }>(
      `INSERT INTO trip_share_links (booking_id, token_hash, expires_at)
       SELECT id, $3, now() + make_interval(hours => $4) FROM bookings
       WHERE id = $1 AND client_id = $2 AND status = ANY($5::booking_status[])
       RETURNING expires_at`,
      [bookingId, client.id, hashToken(token), SHARE_LINK_MAX_HOURS, LIVE_STATUSES],
    );
    if (!rows[0]) throw new NotFoundException('You can share a trip once a driver has accepted it');
    await writeAudit(this.pool, {
      actorId: client.id,
      action: 'trip.shared',
      entity: 'booking',
      entityId: bookingId,
    });
    return {
      url: `${this.config.publicWebUrl}/track/${token}`,
      expiresAt: rows[0].expires_at.toISOString(),
    };
  }

  /** What a share link shows. Location only while the trip is live. */
  async track(token: string): Promise<TrackView> {
    const { rows } = await this.pool.query<{
      status: string;
      driver_name: string | null;
      make_model: string;
      colour: string | null;
      plate_number: string;
      pickup_label: string;
      destination_label: string | null;
      started_at: Date | null;
      ended_at: Date | null;
      lat: number | null;
      lng: number | null;
      at: Date | null;
    }>(
      `SELECT b.status, du.full_name AS driver_name, v.make_model, v.colour, v.plate_number,
              b.pickup_label, b.destination_label, b.started_at, b.ended_at,
              loc.lat, loc.lng, loc.at
       FROM trip_share_links l
       JOIN bookings b ON b.id = l.booking_id
       JOIN vehicles v ON v.id = b.vehicle_id
       LEFT JOIN users du ON du.id = b.driver_id
       LEFT JOIN LATERAL (
         SELECT ST_Y(tl.location::geometry) AS lat, ST_X(tl.location::geometry) AS lng, tl.recorded_at AS at
         FROM trip_locations tl WHERE tl.booking_id = b.id ORDER BY tl.recorded_at DESC LIMIT 1
       ) loc ON b.status IN ('accepted', 'driver_arrived', 'in_progress')
       WHERE l.token_hash = $1 AND l.expires_at > now()`,
      [hashToken(token)],
    );
    const t = rows[0];
    if (!t) throw new NotFoundException('This tracking link has expired');
    return {
      status: t.status,
      driverFirstName: t.driver_name?.split(' ')[0] ?? null,
      vehicle: { makeModel: t.make_model, colour: t.colour, plateNumber: t.plate_number },
      pickupLabel: t.pickup_label,
      destinationLabel: t.destination_label,
      location:
        t.lat != null && t.lng != null && t.at
          ? { lat: t.lat, lng: t.lng, at: t.at.toISOString() }
          : null,
      startedAt: t.started_at?.toISOString() ?? null,
      endedAt: t.ended_at?.toISOString() ?? null,
    };
  }

  /** Moves the trip from one status to the next, with checks, an audit entry and a live update. */
  private async move(
    driver: AuthUser,
    bookingId: string,
    from: string,
    to: string,
    stamp: 'arrived_at' | 'started_at' | 'ended_at',
    check?: (db: PoolClient, trip: TripRow) => Promise<Record<string, unknown> | void>,
  ): Promise<BookingView> {
    await inTransaction(this.pool, async (db) => {
      const trip = await this.lock(db, driver, bookingId);
      if (trip.status === to) return; // Already done: a repeated tap is harmless.
      if (trip.status !== from)
        throw new ConflictException(`This trip is ${trip.status.replace('_', ' ')}`);
      const extra = (await check?.(db, trip)) ?? {};
      await db.query(`UPDATE bookings SET status = $2, ${stamp} = now() WHERE id = $1`, [
        bookingId,
        to,
      ]);
      await writeAudit(db, {
        actorId: driver.id,
        action: `booking.${to}`,
        entity: 'booking',
        entityId: bookingId,
        details: { from, to, ...extra },
      });
    });
    return this.viewAndTell(driver, bookingId);
  }

  private async lock(db: PoolClient, driver: AuthUser, bookingId: string): Promise<TripRow> {
    const { rows } = await db.query<TripRow>(
      `SELECT id, status, trip_type, client_id, driver_id, trip_pin_encrypted, pin_verified_at, pin_attempts,
              CASE WHEN pin_locked_until > now()
                   THEN ceil(extract(epoch FROM pin_locked_until - now()) / 60)::int END AS pin_locked_for
       FROM bookings WHERE id = $1 AND driver_id = $2 FOR UPDATE`,
      [bookingId, driver.id],
    );
    if (!rows[0]) throw new NotFoundException('Trip not found');
    return rows[0];
  }

  private requirePhotoPhase(trip: TripRow, phase: PhotoPhase): void {
    if (trip.trip_type !== 'drive_alone')
      throw new BadRequestException('Only Drive my car alone trips need car photos');
    const ok =
      phase === 'before' ? trip.status === 'driver_arrived' : trip.status === 'in_progress';
    if (!ok) {
      throw new ConflictException(
        phase === 'before'
          ? 'Take the handover photos after arriving, before the trip starts'
          : 'Take the return photos before ending the trip',
      );
    }
  }

  private async requireAllPhotos(
    db: PoolClient,
    bookingId: string,
    phase: PhotoPhase,
  ): Promise<void> {
    const { rows } = await db.query<{ shot: string }>(
      `SELECT shot FROM trip_photos WHERE booking_id = $1 AND phase = $2`,
      [bookingId, phase],
    );
    const missing = TRIP_PHOTO_SHOTS.filter((s) => !rows.some((r) => r.shot === s));
    if (missing.length) {
      throw new ConflictException(
        `Take all five ${phase === 'before' ? 'handover' : 'return'} photos first. Missing: ${missing.join(', ')}`,
      );
    }
  }

  private async viewAndTell(driver: AuthUser, bookingId: string): Promise<BookingView> {
    const view = (await loadBookingView(this.pool, this.storage, this.crypto, bookingId, driver))!;
    const { rows } = await this.pool.query<{ client_id: string }>(
      `SELECT client_id FROM bookings WHERE id = $1`,
      [bookingId],
    );
    this.events.send(this.events.bookingChanged(bookingId, [rows[0]?.client_id]));
    return view;
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
