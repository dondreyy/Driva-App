import { assertKobo, Kobo, roundToNearest } from './money';

export type TripType = 'ride_with_me' | 'drive_alone';

/**
 * Mirrors a row of the `pricing_rules` table. The API loads the rule for the booking's
 * city (or the default rule) and passes it in, so no price is hard coded in app code.
 */
export interface PricingRule {
  hourlyRateKobo: Kobo;
  minHours: number;
  soloBaseKobo: Kobo;
  soloPerKmKobo: Kobo;
  /** Drive my car alone fares are rounded to the nearest multiple of this. */
  soloRoundingKobo: Kobo;
  nightSurchargeKobo: Kobo;
  /** Night runs from this local time (minutes after midnight, inclusive)... */
  nightStartMinute: number;
  /** ...until this local time the next morning (exclusive). */
  nightEndMinute: number;
  /** Basis points, 1500 = 15.00%. */
  commissionFirstYearBps: number;
  commissionAfterBps: number;
  /** Length of the first-year commission window, counted from the driver's approval date. */
  firstYearMonths: number;
}

/** Same defaults as `pricing_rules` in database/schema.sql. */
export const DEFAULT_PRICING_RULE: Readonly<PricingRule> = Object.freeze({
  hourlyRateKobo: 350_000,
  minHours: 2,
  soloBaseKobo: 250_000,
  soloPerKmKobo: 30_000,
  soloRoundingKobo: 10_000,
  nightSurchargeKobo: 150_000,
  nightStartMinute: 21 * 60, // 9pm
  nightEndMinute: 5 * 60, // 5am
  commissionFirstYearBps: 1500,
  commissionAfterBps: 2000,
  firstYearMonths: 12,
});

export type QuoteInput =
  | { tripType: 'ride_with_me'; hours: number; isNight: boolean }
  | { tripType: 'drive_alone'; distanceKm: number; isNight: boolean };

export interface Quote {
  baseFareKobo: Kobo;
  nightKobo: Kobo;
  totalFareKobo: Kobo;
}

export class PricingError extends RangeError {
  override name = 'PricingError';
}

/**
 * A trip is a night trip when its pickup time, in the city's own time zone, falls between
 * 9pm (inclusive) and 5am (exclusive). The quote shows the surcharge before booking.
 */
export function isNightPickup(
  pickupAt: Date,
  timeZone = 'Africa/Lagos',
  rule: Pick<PricingRule, 'nightStartMinute' | 'nightEndMinute'> = DEFAULT_PRICING_RULE,
): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(pickupAt);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  const local = hour * 60 + minute;
  const { nightStartMinute: start, nightEndMinute: end } = rule;
  // The window crosses midnight when it starts later in the day than it ends.
  return start > end ? local >= start || local < end : local >= start && local < end;
}

/** Price a trip. No booking fee is ever added for clients. */
export function quoteFare(input: QuoteInput, rule: PricingRule = DEFAULT_PRICING_RULE): Quote {
  const baseFareKobo =
    input.tripType === 'ride_with_me'
      ? rideWithMeFare(input.hours, rule)
      : driveAloneFare(input.distanceKm, rule);
  const nightKobo = input.isNight ? rule.nightSurchargeKobo : 0;
  return { baseFareKobo, nightKobo, totalFareKobo: baseFareKobo + nightKobo };
}

function rideWithMeFare(hours: number, rule: PricingRule): Kobo {
  if (!Number.isInteger(hours)) {
    throw new PricingError(`Ride with me is booked in whole hours, got ${hours}`);
  }
  if (hours < rule.minHours) {
    throw new PricingError(`Ride with me needs at least ${rule.minHours} hours, got ${hours}`);
  }
  return hours * rule.hourlyRateKobo;
}

function driveAloneFare(distanceKm: number, rule: PricingRule): Kobo {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new PricingError(`Distance must be zero or more km, got ${distanceKm}`);
  }
  // Distances are stored to 0.1 km (bookings.distance_km). Work in tenths so the
  // arithmetic stays in integers.
  const tenthsOfKm = Math.round(distanceKm * 10);
  const raw = rule.soloBaseKobo + (tenthsOfKm * rule.soloPerKmKobo) / 10;
  return roundToNearest(Math.round(raw), rule.soloRoundingKobo);
}

/**
 * The driver's commission rate for a trip completed at `completedAt`. The rate is per
 * driver: the first-year rate applies until `firstYearMonths` after their approval date.
 * Store the result on the trip when it completes.
 */
export function commissionBpsFor(
  driverApprovedAt: Date,
  completedAt: Date,
  rule: PricingRule = DEFAULT_PRICING_RULE,
): number {
  const windowEnds = addMonthsUtc(driverApprovedAt, rule.firstYearMonths);
  return completedAt.getTime() < windowEnds.getTime()
    ? rule.commissionFirstYearBps
    : rule.commissionAfterBps;
}

export interface FareSplit {
  commissionKobo: Kobo;
  driverEarningKobo: Kobo;
}

/** Splits a completed fare into Driva's commission and the driver's earning. */
export function splitFare(totalFareKobo: Kobo, commissionBps: number): FareSplit {
  assertKobo(totalFareKobo, 'totalFareKobo');
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 10_000) {
    throw new PricingError(`commissionBps must be 0 to 10000, got ${commissionBps}`);
  }
  const commissionKobo = Math.floor((totalFareKobo * commissionBps + 5_000) / 10_000);
  return { commissionKobo, driverEarningKobo: totalFareKobo - commissionKobo };
}

/** Adds calendar months in UTC, clamping to the last day of a shorter month. */
export function addMonthsUtc(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}
