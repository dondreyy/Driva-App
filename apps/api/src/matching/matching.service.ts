import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  BookingView,
  commissionBpsFor,
  DriverOffer,
  MATCH_RADIUS_KM,
  OFFER_SECONDS,
  SCHEDULED_MATCHING_LEAD_MINUTES,
  LOCATION_STALE_SECONDS,
  splitFare,
  TripType,
  VETTING_VALID_MONTHS,
} from '@driva/shared';
import { Pool, PoolClient } from 'pg';
import { loadBookingView } from '../bookings/booking-view';
import { writeAudit } from '../common/audit';
import { inTransaction, PG_POOL } from '../database/database.module';
import { FILE_STORAGE, FileStorage } from '../storage/file-storage';

/**
 * Offers each booking to the nearest eligible driver, one at a time, for 30 seconds.
 * Eligible: approved with vetting under 12 months old, online with a recent location, in the
 * booking's city, within 8 km of the pickup, no active trip, no other request open, and not
 * already asked about this booking.
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  /**
   * One pass of the matcher: expire old offers, then find a driver for every booking that is
   * due and has no request open. Safe to run on several servers at once.
   */
  async sweep(): Promise<void> {
    await this.pool.query(
      `UPDATE booking_offers SET status = 'expired', responded_at = now()
       WHERE status = 'offered' AND expires_at <= now()`,
    );
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT b.id FROM bookings b
       WHERE b.status IN ('requested', 'matching')
         AND coalesce(b.scheduled_for, b.created_at) - make_interval(mins => $1) <= now()
         AND NOT EXISTS (SELECT 1 FROM booking_offers o WHERE o.booking_id = b.id AND o.status = 'offered')
       ORDER BY b.created_at`,
      [SCHEDULED_MATCHING_LEAD_MINUTES],
    );
    for (const { id } of rows) {
      try {
        await inTransaction(this.pool, (db) => this.dispatch(db, id));
      } catch (err) {
        this.logger.error(`Matching failed for booking ${id}: ${(err as Error).message}`);
      }
    }
  }

  /** Offers the booking to the next driver, or gives up when its time has run out. */
  async dispatch(db: PoolClient, bookingId: string): Promise<void> {
    const locked = await db.query<{
      status: string;
      past_deadline: boolean;
      has_open_offer: boolean;
    }>(
      `SELECT b.status, b.matching_deadline <= now() AS past_deadline,
              EXISTS (SELECT 1 FROM booking_offers o WHERE o.booking_id = b.id AND o.status = 'offered') AS has_open_offer
       FROM bookings b WHERE b.id = $1 FOR UPDATE SKIP LOCKED`,
      [bookingId],
    );
    const booking = locked.rows[0];
    // Locked by another server, already matched or cancelled, or a request is already out.
    if (!booking || !['requested', 'matching'].includes(booking.status) || booking.has_open_offer)
      return;

    const driver = await db.query<{ user_id: string }>(
      `SELECT d.user_id
       FROM bookings b
       JOIN drivers d ON d.city_id = b.city_id
       JOIN driver_presence p ON p.driver_id = d.user_id
       JOIN driver_shifts s ON s.id = p.shift_id AND s.ended_at IS NULL
       WHERE b.id = $1
         AND d.status = 'approved'
         AND d.last_full_vetting_at > now() - make_interval(months => $2)
         AND p.updated_at > now() - make_interval(secs => $3)
         AND ST_DWithin(p.location, b.pickup, $4)
         AND NOT EXISTS (SELECT 1 FROM bookings x WHERE x.driver_id = d.user_id
                         AND x.status IN ('accepted', 'driver_arrived', 'in_progress'))
         AND NOT EXISTS (SELECT 1 FROM booking_offers o WHERE o.driver_id = d.user_id AND o.status = 'offered')
         AND NOT EXISTS (SELECT 1 FROM booking_offers o WHERE o.booking_id = b.id AND o.driver_id = d.user_id)
       ORDER BY ST_Distance(p.location, b.pickup)
       LIMIT 1
       FOR UPDATE OF d SKIP LOCKED`,
      [bookingId, VETTING_VALID_MONTHS, LOCATION_STALE_SECONDS, MATCH_RADIUS_KM * 1000],
    );
    const driverId = driver.rows[0]?.user_id;

    if (driverId) {
      await db.query(
        `INSERT INTO booking_offers (booking_id, driver_id, expires_at)
         VALUES ($1, $2, now() + make_interval(secs => $3))`,
        [bookingId, driverId, OFFER_SECONDS],
      );
      if (booking.status === 'requested')
        await this.setStatus(db, bookingId, 'requested', 'matching');
      return;
    }
    if (booking.past_deadline) {
      await db.query(`UPDATE bookings SET status = 'no_driver' WHERE id = $1`, [bookingId]);
      await writeAudit(db, {
        actorId: null,
        action: 'booking.no_driver',
        entity: 'booking',
        entityId: bookingId,
        details: { from: booking.status },
      });
      return;
    }
    // Nobody free right now. Keep looking on the next sweep until the deadline.
    if (booking.status === 'requested')
      await this.setStatus(db, bookingId, 'requested', 'matching');
  }

  /** The request in front of this driver, if any. */
  async currentOffer(driverId: string): Promise<DriverOffer | null> {
    const { rows } = await this.pool.query<{
      id: string;
      booking_id: string;
      expires_at: Date;
      trip_type: TripType;
      pickup_label: string;
      pickup_lat: number;
      pickup_lng: number;
      destination_label: string | null;
      destination_lat: number | null;
      destination_lng: number | null;
      hours: number | null;
      task: string | null;
      distance_km: string | null;
      scheduled_for: Date | null;
      is_night: boolean;
      total_fare_kobo: string;
      approved_at: Date;
      metres_to_pickup: number;
      seconds_left: number;
    }>(
      `SELECT o.id, o.booking_id, o.expires_at, b.trip_type, b.pickup_label,
              ST_Y(b.pickup::geometry) AS pickup_lat, ST_X(b.pickup::geometry) AS pickup_lng,
              b.destination_label, ST_Y(b.destination::geometry) AS destination_lat,
              ST_X(b.destination::geometry) AS destination_lng, b.hours, b.task, b.distance_km,
              b.scheduled_for, b.is_night, b.total_fare_kobo, d.approved_at,
              coalesce(ST_Distance(p.location, b.pickup), 0) AS metres_to_pickup,
              ceil(extract(epoch FROM o.expires_at - now()))::int AS seconds_left
       FROM booking_offers o
       JOIN bookings b ON b.id = o.booking_id
       JOIN drivers d ON d.user_id = o.driver_id
       LEFT JOIN driver_presence p ON p.driver_id = o.driver_id
       WHERE o.driver_id = $1 AND o.status = 'offered' AND o.expires_at > now()`,
      [driverId],
    );
    const o = rows[0];
    if (!o) return null;
    const total = Number(o.total_fare_kobo);
    // Shown at the driver's own rate today. The rate stored on the trip is set when it completes.
    const commissionBps = commissionBpsFor(o.approved_at, new Date());
    const split = splitFare(total, commissionBps);
    return {
      id: o.id,
      bookingId: o.booking_id,
      expiresAt: o.expires_at.toISOString(),
      secondsLeft: o.seconds_left,
      tripType: o.trip_type,
      pickup: { label: o.pickup_label, lat: o.pickup_lat, lng: o.pickup_lng },
      destination:
        o.destination_label && o.destination_lat != null && o.destination_lng != null
          ? { label: o.destination_label, lat: o.destination_lat, lng: o.destination_lng }
          : null,
      hours: o.hours,
      task: o.task,
      distanceKm: o.distance_km === null ? null : Number(o.distance_km),
      pickupAt: o.scheduled_for?.toISOString() ?? null,
      isNight: o.is_night,
      totalFareKobo: total,
      commissionBps,
      commissionKobo: split.commissionKobo,
      driverEarningKobo: split.driverEarningKobo,
      kmToPickup: Math.round(o.metres_to_pickup / 100) / 10,
    };
  }

  /** The driver takes the trip. The fare locks now and never changes. */
  async accept(driverId: string, offerId: string): Promise<BookingView> {
    const bookingId = await inTransaction(this.pool, async (db) => {
      const { rows } = await db.query<{
        booking_id: string;
        status: string;
        expired: boolean;
        booking_status: string;
        total_fare_kobo: string;
      }>(
        `SELECT o.booking_id, o.status, o.expires_at <= now() AS expired, b.status AS booking_status,
                b.total_fare_kobo
         FROM booking_offers o JOIN bookings b ON b.id = o.booking_id
         WHERE o.id = $1 AND o.driver_id = $2
         FOR UPDATE OF o, b`,
        [offerId, driverId],
      );
      const offer = rows[0];
      if (!offer) throw new NotFoundException('Request not found');
      if (offer.status !== 'offered' || offer.expired) {
        throw new ConflictException('This request has expired');
      }
      if (offer.booking_status !== 'matching') {
        throw new ConflictException('The client cancelled this request');
      }
      await db.query(
        `UPDATE booking_offers SET status = 'accepted', responded_at = now() WHERE id = $1`,
        [offerId],
      );
      try {
        await db.query(
          `UPDATE bookings SET status = 'accepted', driver_id = $2, accepted_at = now(), fare_locked_at = now()
           WHERE id = $1`,
          [offer.booking_id, driverId],
        );
      } catch (err) {
        if ((err as { constraint?: string }).constraint === 'one_active_trip_per_driver') {
          throw new ConflictException('Finish your current trip first');
        }
        throw err;
      }
      await writeAudit(db, {
        actorId: driverId,
        action: 'booking.accepted',
        entity: 'booking',
        entityId: offer.booking_id,
        details: {
          from: 'matching',
          to: 'accepted',
          driverId,
          lockedFareKobo: Number(offer.total_fare_kobo),
        },
      });
      return offer.booking_id;
    });
    return (await loadBookingView(this.pool, this.storage, bookingId, {
      id: driverId,
      role: 'driver',
    }))!;
  }

  /** The driver passes. The next driver is asked straight away. */
  async decline(driverId: string, offerId: string): Promise<void> {
    await inTransaction(this.pool, async (db) => {
      const { rows } = await db.query<{ booking_id: string }>(
        `UPDATE booking_offers SET status = 'declined', responded_at = now()
         WHERE id = $1 AND driver_id = $2 AND status = 'offered'
         RETURNING booking_id`,
        [offerId, driverId],
      );
      if (!rows[0]) throw new NotFoundException('Request not found or already answered');
      await this.dispatch(db, rows[0].booking_id);
    });
  }

  private async setStatus(db: PoolClient, bookingId: string, from: string, to: string) {
    await db.query(`UPDATE bookings SET status = $2 WHERE id = $1`, [bookingId, to]);
    await writeAudit(db, {
      actorId: null,
      action: `booking.${to}`,
      entity: 'booking',
      entityId: bookingId,
      details: { from, to },
    });
  }
}
