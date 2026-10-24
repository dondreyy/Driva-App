import { z } from 'zod';
import type { Kobo } from './money';
import type { TripType } from './pricing';

export const DRIVE_ALONE_TASKS = [
  'Pick someone up',
  'Run an errand',
  'Take car for service',
  'Deliver car',
] as const;
export type DriveAloneTask = (typeof DRIVE_ALONE_TASKS)[number];

/** The longest Ride with me booking the app offers, as in the prototype's hour stepper. */
export const MAX_RIDE_HOURS = 12;
/** How far ahead a trip can be booked. */
export const MAX_DAYS_AHEAD = 7;
/** How long a quote's price is held before the client must ask again. */
export const QUOTE_TTL_MINUTES = 15;

export const latLngSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();
export type LatLng = z.infer<typeof latLngSchema>;

export const placeSchema = latLngSchema
  .extend({ label: z.string().trim().min(1).max(200) })
  .strict();
export type Place = z.infer<typeof placeSchema>;

export const quoteRequestSchema = z
  .object({
    tripType: z.enum(['ride_with_me', 'drive_alone']),
    pickup: placeSchema,
    destination: placeSchema.optional(),
    hours: z
      .number()
      .int('Book whole hours')
      .min(2, 'Ride with me is at least 2 hours')
      .max(MAX_RIDE_HOURS, `Ride with me is at most ${MAX_RIDE_HOURS} hours`)
      .optional(),
    task: z.enum(DRIVE_ALONE_TASKS).optional(),
    /** Omit for now. */
    pickupAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.tripType === 'ride_with_me' && v.hours === undefined) {
      ctx.addIssue({ code: 'custom', path: ['hours'], message: 'Choose how many hours' });
    }
    if (v.tripType === 'drive_alone') {
      if (!v.destination) {
        ctx.addIssue({
          code: 'custom',
          path: ['destination'],
          message: 'Choose where the car is going',
        });
      }
      if (!v.task) {
        ctx.addIssue({
          code: 'custom',
          path: ['task'],
          message: 'Choose what the driver should do',
        });
      }
      if (v.hours !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['hours'],
          message: 'Drive my car alone is not booked by the hour',
        });
      }
    }
  });
export type QuoteRequest = z.input<typeof quoteRequestSchema>;
export type ParsedQuoteRequest = z.output<typeof quoteRequestSchema>;

export interface QuoteView {
  id: string;
  cityId: string;
  tripType: TripType;
  pickup: Place;
  destination: Place | null;
  distanceKm: number | null;
  durationMinutes: number | null;
  hours: number | null;
  task: string | null;
  /** Null means now. */
  pickupAt: string | null;
  isNight: boolean;
  baseFareKobo: Kobo;
  nightKobo: Kobo;
  totalFareKobo: Kobo;
  /** Rates used, so the screen can explain the price without hard coding it. */
  hourlyRateKobo: Kobo;
  expiresAt: string;
}

export interface PlaceSuggestion {
  placeId: string;
  title: string;
  subtitle: string;
}

export const vehicleSchema = z
  .object({
    makeModel: z.string().trim().min(2, 'Enter the make and model').max(60),
    plateNumber: z
      .string()
      .transform((v) => v.trim().toUpperCase().replace(/\s+/g, ' '))
      .pipe(
        z
          .string()
          .regex(
            /^[A-Z0-9][A-Z0-9 -]{3,10}[A-Z0-9]$/,
            'Enter the plate number as shown on the car',
          ),
      ),
    colour: z.string().trim().max(30).optional(),
    transmission: z.enum(['automatic', 'manual'], {
      errorMap: () => ({ message: 'Choose automatic or manual' }),
    }),
  })
  .strict();
export type VehicleRequest = z.input<typeof vehicleSchema>;
export type ParsedVehicle = z.output<typeof vehicleSchema>;

export interface Vehicle {
  id: string;
  makeModel: string;
  plateNumber: string;
  colour: string | null;
  transmission: 'automatic' | 'manual' | null;
}
