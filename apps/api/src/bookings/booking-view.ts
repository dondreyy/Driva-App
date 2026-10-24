import type {
  AssignedDriver,
  BookingStatus,
  BookingView,
  PhotoPhase,
  TripPhoto,
  TripType,
} from '@driva/shared';
import { Pool, PoolClient } from 'pg';
import { FieldEncryption } from '../crypto/field-encryption';
import { FileStorage } from '../storage/file-storage';

/** Statuses where the driver is on their way or driving, and the client can see where they are. */
export const LIVE_STATUSES = ['accepted', 'driver_arrived', 'in_progress'];

interface BookingRow {
  id: string;
  status: BookingStatus;
  trip_type: TripType;
  client_id: string;
  driver_id: string | null;
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
  base_fare_kobo: string;
  night_kobo: string;
  total_fare_kobo: string;
  fare_locked_at: Date | null;
  driver_earning_kobo: string | null;
  matching_deadline: Date | null;
  created_at: Date;
  accepted_at: Date | null;
  arrived_at: Date | null;
  started_at: Date | null;
  ended_at: Date | null;
  cancelled_at: Date | null;
  trip_pin_encrypted: Buffer | null;
  pin_verified_at: Date | null;
  commission_bps: number | null;
  commission_kobo: string | null;
  make_model: string;
  plate_number: string;
  colour: string | null;
  transmission: string | null;
  client_name: string;
  driver_name: string | null;
  rating_avg: string | null;
  rating_count: number | null;
  driver_photo_key: string | null;
  loc_lat: number | null;
  loc_lng: number | null;
  loc_at: Date | null;
}

/** Loads a booking for one of the two people allowed to see it: its client or its driver. */
export async function loadBookingView(
  db: Pool | PoolClient,
  storage: FileStorage,
  crypto: FieldEncryption,
  bookingId: string,
  viewer: { id: string; role: string },
): Promise<BookingView | null> {
  const { rows } = await db.query<BookingRow>(
    `SELECT b.id, b.status, b.trip_type, b.client_id, b.driver_id, b.pickup_label,
            ST_Y(b.pickup::geometry) AS pickup_lat, ST_X(b.pickup::geometry) AS pickup_lng,
            b.destination_label, ST_Y(b.destination::geometry) AS destination_lat,
            ST_X(b.destination::geometry) AS destination_lng, b.hours, b.task, b.distance_km,
            b.scheduled_for, b.is_night, b.base_fare_kobo, b.night_kobo, b.total_fare_kobo,
            b.fare_locked_at, b.driver_earning_kobo, b.matching_deadline, b.created_at,
            b.accepted_at, b.arrived_at, b.started_at, b.ended_at, b.cancelled_at,
            b.trip_pin_encrypted, b.pin_verified_at, b.commission_bps, b.commission_kobo, v.make_model, v.plate_number, v.colour, v.transmission,
            cu.full_name AS client_name, du.full_name AS driver_name, d.rating_avg, d.rating_count,
            (SELECT storage_key FROM driver_documents dd
              WHERE dd.driver_id = b.driver_id AND dd.kind = 'passport_photo'
              ORDER BY created_at DESC LIMIT 1) AS driver_photo_key,
            loc.lat AS loc_lat, loc.lng AS loc_lng, loc.at AS loc_at
     FROM bookings b
     LEFT JOIN LATERAL (
       -- While the trip is live: the newest trip point, or the driver's presence on the way.
       SELECT * FROM (
         SELECT ST_Y(tl.location::geometry) AS lat, ST_X(tl.location::geometry) AS lng, tl.recorded_at AS at
         FROM trip_locations tl WHERE tl.booking_id = b.id
         UNION ALL
         SELECT ST_Y(p.location::geometry), ST_X(p.location::geometry), p.updated_at
         FROM driver_presence p WHERE p.driver_id = b.driver_id
       ) points
       WHERE b.status IN ('accepted', 'driver_arrived', 'in_progress')
       ORDER BY at DESC LIMIT 1
     ) loc ON true
     JOIN vehicles v ON v.id = b.vehicle_id
     JOIN users cu ON cu.id = b.client_id
     LEFT JOIN drivers d ON d.user_id = b.driver_id
     LEFT JOIN users du ON du.id = b.driver_id
     WHERE b.id = $1`,
    [bookingId],
  );
  const b = rows[0];
  if (!b) return null;
  const isClient = viewer.id === b.client_id;
  const isDriver = viewer.id === b.driver_id;
  if (!isClient && !isDriver) return null;

  let driver: AssignedDriver | null = null;
  if (b.driver_id && b.driver_name) {
    driver = {
      firstName: b.driver_name.split(' ')[0]!,
      photoUrl: b.driver_photo_key ? await storage.createDownloadUrl(b.driver_photo_key) : null,
      ratingAvg: b.rating_avg === null ? null : Number(b.rating_avg),
      ratingCount: b.rating_count ?? 0,
      vettedBy: 'VeriQuest',
    };
  }

  let photos: TripPhoto[] = [];
  if (b.trip_type === 'drive_alone') {
    const rows = await db.query<{
      phase: PhotoPhase;
      shot: TripPhoto['shot'];
      storage_key: string;
      taken_at: Date;
    }>(
      `SELECT phase, shot, storage_key, taken_at FROM trip_photos WHERE booking_id = $1 ORDER BY phase DESC, shot`,
      [b.id],
    );
    photos = await Promise.all(
      rows.rows.map(async (p) => ({
        phase: p.phase,
        shot: p.shot,
        url: await storage.createDownloadUrl(p.storage_key),
        takenAt: p.taken_at.toISOString(),
      })),
    );
  }

  // The client sees the PIN from acceptance until the driver has entered it.
  const showPin =
    isClient &&
    !!b.trip_pin_encrypted &&
    !b.pin_verified_at &&
    ['accepted', 'driver_arrived'].includes(b.status);
  const completedForDriver = isDriver && b.status === 'completed';

  return {
    id: b.id,
    status: b.status,
    tripType: b.trip_type,
    pickup: { label: b.pickup_label, lat: b.pickup_lat, lng: b.pickup_lng },
    destination:
      b.destination_label && b.destination_lat != null && b.destination_lng != null
        ? { label: b.destination_label, lat: b.destination_lat, lng: b.destination_lng }
        : null,
    hours: b.hours,
    task: b.task,
    distanceKm: b.distance_km === null ? null : Number(b.distance_km),
    pickupAt: b.scheduled_for?.toISOString() ?? null,
    isNight: b.is_night,
    baseFareKobo: Number(b.base_fare_kobo),
    nightKobo: Number(b.night_kobo),
    totalFareKobo: Number(b.total_fare_kobo),
    fareLockedAt: b.fare_locked_at?.toISOString() ?? null,
    vehicle: {
      makeModel: b.make_model,
      plateNumber: b.plate_number,
      colour: b.colour,
      transmission: b.transmission,
    },
    clientFirstName: b.client_name.split(' ')[0]!,
    driver,
    driverEarningKobo:
      isDriver && b.driver_earning_kobo !== null ? Number(b.driver_earning_kobo) : null,
    matchingDeadline: b.matching_deadline?.toISOString() ?? null,
    createdAt: b.created_at.toISOString(),
    acceptedAt: b.accepted_at?.toISOString() ?? null,
    arrivedAt: b.arrived_at?.toISOString() ?? null,
    startedAt: b.started_at?.toISOString() ?? null,
    endedAt: b.ended_at?.toISOString() ?? null,
    cancelledAt: b.cancelled_at?.toISOString() ?? null,
    tripPin: showPin ? crypto.decrypt(b.trip_pin_encrypted!) : null,
    pinVerified: !!b.pin_verified_at,
    photos,
    driverLocation:
      b.loc_lat != null && b.loc_lng != null && b.loc_at
        ? { lat: b.loc_lat, lng: b.loc_lng, at: b.loc_at.toISOString() }
        : null,
    commissionBps: completedForDriver ? b.commission_bps : null,
    commissionKobo:
      completedForDriver && b.commission_kobo !== null ? Number(b.commission_kobo) : null,
  };
}
