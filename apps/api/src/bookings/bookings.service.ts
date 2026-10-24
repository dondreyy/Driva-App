import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { BookingView, MATCHING_WINDOW_MINUTES } from '@driva/shared';
import { Pool } from 'pg';
import { AuthUser } from '../auth/decorators';
import { writeAudit } from '../common/audit';
import { inTransaction, PG_POOL } from '../database/database.module';
import { MatchingService } from '../matching/matching.service';
import { FILE_STORAGE, FileStorage } from '../storage/file-storage';
import { loadBookingView } from './booking-view';

const ACTIVE = ['requested', 'matching', 'accepted', 'driver_arrived', 'in_progress'];
/** The client can cancel until the driver arrives. */
const CANCELLABLE = ['requested', 'matching', 'accepted'];

@Injectable()
export class BookingsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly matching: MatchingService,
  ) {}

  /**
   * Turns a quote into a booking at exactly the quoted price, then starts matching.
   * Payment is held here once payments arrive (Step 7).
   */
  async create(client: AuthUser, quoteId: string, vehicleId: string): Promise<BookingView> {
    const bookingId = await inTransaction(this.pool, async (db) => {
      const quote = await db.query<{
        expired: boolean;
        booked: boolean;
        live: boolean;
        scheduled_for: Date | null;
      }>(
        `SELECT q.expires_at <= now() AS expired, q.scheduled_for, c.is_live AS live,
                EXISTS (SELECT 1 FROM bookings b WHERE b.quote_id = q.id) AS booked
         FROM quotes q JOIN cities c ON c.id = q.city_id
         WHERE q.id = $1 AND q.client_id = $2`,
        [quoteId, client.id],
      );
      const q = quote.rows[0];
      if (!q) throw new NotFoundException('Quote not found');
      if (q.booked) throw new ConflictException('This quote has already been booked');
      if (q.expired)
        throw new UnprocessableEntityException('This price has expired. Get a new one.');
      if (!q.live)
        throw new UnprocessableEntityException(
          'Driva is not taking bookings in this city right now',
        );
      if (q.scheduled_for && q.scheduled_for.getTime() < Date.now()) {
        throw new UnprocessableEntityException('That pickup time has passed. Get a new price.');
      }

      const car = await db.query(`SELECT 1 FROM vehicles WHERE id = $1 AND owner_user_id = $2`, [
        vehicleId,
        client.id,
      ]);
      if (!car.rowCount) throw new ForbiddenException('Choose one of your own cars');

      // One trip at a time per client for now. Business accounts booking for staff will need more.
      const open = await db.query(
        `SELECT 1 FROM bookings WHERE client_id = $1 AND status = ANY($2::booking_status[]) FOR UPDATE`,
        [client.id, ACTIVE],
      );
      if (open.rowCount) throw new ConflictException('You already have a trip in progress');

      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO bookings (city_id, trip_type, status, client_id, vehicle_id, pickup_label, pickup,
           destination_label, destination, planned_route, distance_km, hours, task, scheduled_for, is_night,
           base_fare_kobo, night_kobo, total_fare_kobo, quote_id, matching_deadline)
         SELECT city_id, trip_type, 'requested', client_id, $3, pickup_label, pickup,
           destination_label, destination, planned_route, distance_km, hours, task, scheduled_for, is_night,
           base_fare_kobo, night_kobo, total_fare_kobo, id,
           -- A trip for now looks for a driver for a few minutes; a scheduled trip until its pickup time.
           coalesce(scheduled_for, now() + make_interval(mins => $4))
         FROM quotes WHERE id = $1 AND client_id = $2
         RETURNING id`,
        [quoteId, client.id, vehicleId, MATCHING_WINDOW_MINUTES],
      );
      const id = rows[0]!.id;
      await writeAudit(db, {
        actorId: client.id,
        action: 'booking.requested',
        entity: 'booking',
        entityId: id,
        details: { quoteId, scheduled: !!q.scheduled_for },
      });
      return id;
    });
    // Ask the first driver straight away rather than waiting for the next sweep.
    if (!(await this.isScheduledLater(bookingId))) {
      await inTransaction(this.pool, (db) => this.matching.dispatch(db, bookingId));
    }
    return this.get(client, bookingId);
  }

  async get(viewer: AuthUser, bookingId: string): Promise<BookingView> {
    const view = await loadBookingView(this.pool, this.storage, bookingId, viewer);
    if (!view) throw new NotFoundException('Booking not found');
    return view;
  }

  /** The client cancels before the driver arrives. No cancellation fee for now. */
  async cancel(client: AuthUser, bookingId: string, reason?: string): Promise<BookingView> {
    await inTransaction(this.pool, async (db) => {
      const { rows } = await db.query<{ status: string }>(
        `SELECT status FROM bookings WHERE id = $1 AND client_id = $2 FOR UPDATE`,
        [bookingId, client.id],
      );
      const status = rows[0]?.status;
      if (!status) throw new NotFoundException('Booking not found');
      if (!CANCELLABLE.includes(status)) {
        throw new ConflictException(
          status === 'cancelled'
            ? 'This trip is already cancelled'
            : 'This trip can no longer be cancelled in the app',
        );
      }
      await db.query(
        `UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2 WHERE id = $1`,
        [bookingId, reason ?? null],
      );
      // Take the request off the driver's screen.
      await db.query(
        `UPDATE booking_offers SET status = 'expired', responded_at = now() WHERE booking_id = $1 AND status = 'offered'`,
        [bookingId],
      );
      await writeAudit(db, {
        actorId: client.id,
        action: 'booking.cancelled',
        entity: 'booking',
        entityId: bookingId,
        details: { from: status, to: 'cancelled', byRole: 'client' },
      });
    });
    return this.get(client, bookingId);
  }

  private async isScheduledLater(bookingId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ later: boolean }>(
      `SELECT coalesce(scheduled_for > now() + interval '30 minutes', false) AS later FROM bookings WHERE id = $1`,
      [bookingId],
    );
    return rows[0]?.later ?? false;
  }
}
