export const TRIP_TYPES = ['ride_with_me', 'drive_alone'] as const;

export const BOOKING_STATUSES = [
  'requested',
  'matching',
  'accepted',
  'driver_arrived',
  'in_progress',
  'completed',
  'cancelled',
  'no_driver',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const TRIP_PHOTO_SHOTS = ['front', 'back', 'left', 'right', 'fuel_dash'] as const;
export type TripPhotoShot = (typeof TRIP_PHOTO_SHOTS)[number];

export const TRIP_PIN_LENGTH = 4;
