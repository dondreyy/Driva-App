import { z } from 'zod';
import { latLngSchema, Place } from './booking';
import type { BookingStatus } from './constants';
import type { Kobo } from './money';
import type { TripType } from './pricing';

/** How long a driver has to accept a request. */
export const OFFER_SECONDS = 30;
/** Only drivers this close to the pickup are asked. */
export const MATCH_RADIUS_KM = 8;
/** A trip for now keeps looking for a driver this long before giving up. */
export const MATCHING_WINDOW_MINUTES = 5;
/** A scheduled trip starts looking for a driver this long before pickup. */
export const SCHEDULED_MATCHING_LEAD_MINUTES = 30;
/** A driver whose app has not sent a location for this long is not offered trips. */
export const LOCATION_STALE_SECONDS = 120;
/** How often the driver app sends its location while online. */
export const LOCATION_INTERVAL_SECONDS = 10;

export const createBookingSchema = z
  .object({ quoteId: z.string().uuid(), vehicleId: z.string().uuid('Choose your car') })
  .strict();
export type CreateBookingRequest = z.input<typeof createBookingSchema>;

export const cancelBookingSchema = z
  .object({ reason: z.string().trim().max(300).optional() })
  .strict();
export type CancelBookingRequest = z.input<typeof cancelBookingSchema>;

export const driverLocationSchema = latLngSchema
  .extend({ heading: z.number().int().min(0).max(359).optional() })
  .strict();
export type DriverLocationRequest = z.input<typeof driverLocationSchema>;

export const startShiftSchema = latLngSchema
  .extend({ selfieKey: z.string().min(1).max(300) })
  .strict();
export type StartShiftRequest = z.input<typeof startShiftSchema>;

/** The driver as the client sees them once they accept. No phone number: calls go through Driva. */
export interface AssignedDriver {
  firstName: string;
  photoUrl: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  vettedBy: 'VeriQuest';
}

export interface BookingView {
  id: string;
  status: BookingStatus;
  tripType: TripType;
  pickup: Place;
  destination: Place | null;
  hours: number | null;
  task: string | null;
  distanceKm: number | null;
  pickupAt: string | null;
  isNight: boolean;
  baseFareKobo: Kobo;
  nightKobo: Kobo;
  totalFareKobo: Kobo;
  fareLockedAt: string | null;
  vehicle: {
    makeModel: string;
    plateNumber: string;
    colour: string | null;
    transmission: string | null;
  };
  /** The client's first name, for the driver. */
  clientFirstName: string;
  driver: AssignedDriver | null;
  /** For the driver only: what they earn at their own commission rate. */
  driverEarningKobo: Kobo | null;
  matchingDeadline: string | null;
  createdAt: string;
  acceptedAt: string | null;
  cancelledAt: string | null;
}

export interface DriverOffer {
  id: string;
  bookingId: string;
  expiresAt: string;
  tripType: TripType;
  pickup: Place;
  destination: Place | null;
  hours: number | null;
  task: string | null;
  distanceKm: number | null;
  pickupAt: string | null;
  isNight: boolean;
  totalFareKobo: Kobo;
  commissionBps: number;
  commissionKobo: Kobo;
  driverEarningKobo: Kobo;
  /** Straight line distance from the driver to the pickup. */
  kmToPickup: number;
}

export interface ShiftView {
  online: boolean;
  startedAt: string | null;
  canGoOnline: boolean;
  /** The trip the driver has accepted and not finished, if any. */
  activeBookingId: string | null;
}
