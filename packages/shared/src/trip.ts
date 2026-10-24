import { z } from 'zod';
import { TRIP_PHOTO_SHOTS, TRIP_PIN_LENGTH } from './constants';
import { UPLOAD_CONTENT_TYPES } from './drivers';

/** Wrong PINs allowed before entry pauses. */
export const PIN_MAX_ATTEMPTS = 5;
/** How long PIN entry pauses after too many wrong tries. */
export const PIN_LOCK_MINUTES = 5;
/** How often the driver app sends its location during a trip. */
export const TRIP_LOCATION_INTERVAL_SECONDS = 5;
/** A share link keeps working this long after the trip ends. */
export const SHARE_LINK_AFTER_TRIP_HOURS = 1;

export const PHOTO_PHASES = ['before', 'after'] as const;
export type PhotoPhase = (typeof PHOTO_PHASES)[number];

export const TRIP_PHOTO_LABELS: Record<(typeof TRIP_PHOTO_SHOTS)[number], string> = {
  front: 'Front',
  back: 'Back',
  left: 'Left',
  right: 'Right',
  fuel_dash: 'Fuel and dash',
};

export const tripPinSchema = z
  .object({
    pin: z
      .string()
      .regex(new RegExp(`^\\d{${TRIP_PIN_LENGTH}}$`), `Enter the ${TRIP_PIN_LENGTH} digit PIN`),
  })
  .strict();

export const tripPhotoUploadSchema = z
  .object({
    phase: z.enum(PHOTO_PHASES),
    shot: z.enum(TRIP_PHOTO_SHOTS),
    contentType: z.enum(UPLOAD_CONTENT_TYPES, {
      errorMap: () => ({ message: 'Upload a JPEG or PNG photo' }),
    }),
  })
  .strict();
export type TripPhotoUploadRequest = z.input<typeof tripPhotoUploadSchema>;

export const tripPhotoSchema = z
  .object({
    phase: z.enum(PHOTO_PHASES),
    shot: z.enum(TRIP_PHOTO_SHOTS),
    key: z.string().min(1).max(300),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .strict();
export type TripPhotoRequest = z.input<typeof tripPhotoSchema>;

export interface TripPhoto {
  phase: PhotoPhase;
  shot: (typeof TRIP_PHOTO_SHOTS)[number];
  url: string;
  takenAt: string;
}

export interface TripLocation {
  lat: number;
  lng: number;
  at: string;
}

/** What a share link shows. No names beyond the driver's first name, no phone numbers. */
export interface TrackView {
  status: string;
  driverFirstName: string | null;
  vehicle: { makeModel: string; colour: string | null; plateNumber: string };
  pickupLabel: string;
  destinationLabel: string | null;
  location: TripLocation | null;
  startedAt: string | null;
  endedAt: string | null;
}

/** Real time events. The payload says what changed; apps fetch the details over REST. */
export const SOCKET_EVENTS = {
  booking: 'booking:changed',
  offer: 'offer:new',
  location: 'trip:location',
} as const;
