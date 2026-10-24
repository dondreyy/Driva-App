import { describe, expect, it } from 'vitest';
import { formatNaira, naira } from './money';
import {
  addMonthsUtc,
  commissionBpsFor,
  DEFAULT_PRICING_RULE,
  isNightPickup,
  PricingError,
  quoteFare,
  splitFare,
} from './pricing';

// Every expectation below is written in naira so it reads like CLAUDE.md.

describe('Ride with me: N3,500 per hour, minimum 2 hours', () => {
  it('charges N7,000 for the 2 hour minimum', () => {
    expect(quoteFare({ tripType: 'ride_with_me', hours: 2, isNight: false })).toEqual({
      baseFareKobo: naira(7_000),
      nightKobo: 0,
      totalFareKobo: naira(7_000),
    });
  });

  it.each([
    [3, 10_500],
    [4, 14_000],
    [8, 28_000],
    [12, 42_000],
  ])('charges N3,500 x %i hours = N%i', (hours, expected) => {
    expect(quoteFare({ tripType: 'ride_with_me', hours, isNight: false }).totalFareKobo).toBe(
      naira(expected),
    );
  });

  it.each([0, 1, -2])('refuses %i hours, below the 2 hour minimum', (hours) => {
    expect(() => quoteFare({ tripType: 'ride_with_me', hours, isNight: false })).toThrow(
      PricingError,
    );
  });

  it('refuses part hours', () => {
    expect(() => quoteFare({ tripType: 'ride_with_me', hours: 2.5, isNight: false })).toThrow(
      PricingError,
    );
  });
});

describe('Drive my car alone: N2,500 base plus N300 per km, rounded to the nearest N100', () => {
  it.each([
    // km, fare in naira
    [0, 2_500],
    [9, 5_200], // 2,500 + 2,700, matches the prototype trip history
    [11, 5_800], // 2,500 + 3,300
    [31, 11_800], // airport: 2,500 + 9,300
    [10, 5_500],
  ])('%s km costs N%i', (distanceKm, expected) => {
    expect(quoteFare({ tripType: 'drive_alone', distanceKm, isNight: false })).toEqual({
      baseFareKobo: naira(expected),
      nightKobo: 0,
      totalFareKobo: naira(expected),
    });
  });

  it.each([
    // 2,500 + 300 x km before rounding -> rounded fare
    [12.1, 6_100], // 6,130 -> 6,100
    [12.2, 6_200], // 6,160 -> 6,200
    [12.5, 6_300], // 6,250 -> 6,300 (halves round up)
    [12.4, 6_200], // 6,220 -> 6,200
    [0.1, 2_500], // 2,530 -> 2,500
    [0.2, 2_600], // 2,560 -> 2,600
  ])('%s km rounds to N%i', (distanceKm, expected) => {
    expect(quoteFare({ tripType: 'drive_alone', distanceKm, isNight: false }).totalFareKobo).toBe(
      naira(expected),
    );
  });

  it('always returns a whole multiple of N100 in integer kobo', () => {
    for (let tenths = 0; tenths <= 1000; tenths++) {
      const fare = quoteFare({ tripType: 'drive_alone', distanceKm: tenths / 10, isNight: false });
      expect(Number.isSafeInteger(fare.totalFareKobo)).toBe(true);
      expect(fare.totalFareKobo % naira(100)).toBe(0);
    }
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('refuses a distance of %s', (distanceKm) => {
    expect(() => quoteFare({ tripType: 'drive_alone', distanceKm, isNight: false })).toThrow(
      PricingError,
    );
  });
});

describe('Night trips add N1,500', () => {
  it('adds N1,500 to Ride with me', () => {
    expect(quoteFare({ tripType: 'ride_with_me', hours: 2, isNight: true })).toEqual({
      baseFareKobo: naira(7_000),
      nightKobo: naira(1_500),
      totalFareKobo: naira(8_500),
    });
  });

  it('adds N1,500 to Drive my car alone, after rounding', () => {
    expect(quoteFare({ tripType: 'drive_alone', distanceKm: 12.1, isNight: true })).toEqual({
      baseFareKobo: naira(6_100),
      nightKobo: naira(1_500),
      totalFareKobo: naira(7_600),
    });
  });
});

describe('Night is a pickup from 9pm to 5am Lagos time', () => {
  // Lagos is UTC+1 all year, so 20:00Z is 9pm in Lagos.
  it.each([
    ['2026-11-02T19:59:00Z', '8:59pm', false],
    ['2026-11-02T20:00:00Z', '9:00pm', true],
    ['2026-11-02T22:30:00Z', '11:30pm', true],
    ['2026-11-02T23:00:00Z', 'midnight', true],
    ['2026-11-03T03:59:00Z', '4:59am', true],
    ['2026-11-03T04:00:00Z', '5:00am', false],
    ['2026-11-03T06:00:00Z', '7:00am', false],
    ['2026-11-03T11:00:00Z', 'noon', false],
  ])('%s (%s in Lagos) is night: %s', (iso, _label, night) => {
    expect(isNightPickup(new Date(iso))).toBe(night);
  });

  it('uses the city’s own time zone', () => {
    // 9:30pm in Lagos is 8:30pm in London.
    const pickup = new Date('2026-11-02T20:30:00Z');
    expect(isNightPickup(pickup, 'Africa/Lagos')).toBe(true);
    expect(isNightPickup(pickup, 'Europe/London')).toBe(false);
  });

  it('follows a city rule with a different window', () => {
    const rule = { nightStartMinute: 22 * 60, nightEndMinute: 6 * 60 };
    expect(isNightPickup(new Date('2026-11-02T20:30:00Z'), 'Africa/Lagos', rule)).toBe(false);
    expect(isNightPickup(new Date('2026-11-03T04:30:00Z'), 'Africa/Lagos', rule)).toBe(true);
  });
});

describe('No booking fee for clients', () => {
  it('total is exactly the base fare plus any night surcharge', () => {
    const day = quoteFare({ tripType: 'ride_with_me', hours: 5, isNight: false });
    expect(day.totalFareKobo).toBe(day.baseFareKobo);
    const night = quoteFare({ tripType: 'drive_alone', distanceKm: 20, isNight: true });
    expect(night.totalFareKobo).toBe(night.baseFareKobo + night.nightKobo);
  });
});

describe('City price overrides', () => {
  it('uses the rule passed in instead of the default', () => {
    const abuja = { ...DEFAULT_PRICING_RULE, hourlyRateKobo: naira(4_000) };
    expect(
      quoteFare({ tripType: 'ride_with_me', hours: 2, isNight: false }, abuja).totalFareKobo,
    ).toBe(naira(8_000));
  });
});

describe('Commission: 15% for a driver’s first 12 months from approval, then 20%', () => {
  const approvedAt = new Date('2026-03-15T09:00:00Z');

  it('is 15% on the approval day', () => {
    expect(commissionBpsFor(approvedAt, approvedAt)).toBe(1500);
  });

  it('is 15% one second before the 12 months end', () => {
    expect(commissionBpsFor(approvedAt, new Date('2027-03-15T08:59:59Z'))).toBe(1500);
  });

  it('is 20% from exactly 12 months after approval', () => {
    expect(commissionBpsFor(approvedAt, new Date('2027-03-15T09:00:00Z'))).toBe(2000);
  });

  it('is 20% well after the first year', () => {
    expect(commissionBpsFor(approvedAt, new Date('2029-01-01T00:00:00Z'))).toBe(2000);
  });

  it('depends on each driver’s own approval date, not a global date', () => {
    const tripAt = new Date('2027-06-01T12:00:00Z');
    expect(commissionBpsFor(new Date('2026-01-10T00:00:00Z'), tripAt)).toBe(2000);
    expect(commissionBpsFor(new Date('2026-09-10T00:00:00Z'), tripAt)).toBe(1500);
  });

  it('handles a 29 February approval date', () => {
    const leap = new Date('2028-02-29T10:00:00Z');
    expect(addMonthsUtc(leap, 12).toISOString()).toBe('2029-02-28T10:00:00.000Z');
    expect(commissionBpsFor(leap, new Date('2029-02-28T09:59:59Z'))).toBe(1500);
    expect(commissionBpsFor(leap, new Date('2029-02-28T10:00:00Z'))).toBe(2000);
  });
});

describe('Fare split', () => {
  it('15% of N7,000 is N1,050, driver keeps N5,950', () => {
    expect(splitFare(naira(7_000), 1500)).toEqual({
      commissionKobo: naira(1_050),
      driverEarningKobo: naira(5_950),
    });
  });

  it('20% of N7,000 is N1,400, driver keeps N5,600', () => {
    expect(splitFare(naira(7_000), 2000)).toEqual({
      commissionKobo: naira(1_400),
      driverEarningKobo: naira(5_600),
    });
  });

  it('takes commission on the whole fare including the night surcharge', () => {
    const { totalFareKobo } = quoteFare({ tripType: 'ride_with_me', hours: 2, isNight: true });
    expect(splitFare(totalFareKobo, 1500)).toEqual({
      commissionKobo: naira(1_275), // 15% of 8,500
      driverEarningKobo: naira(7_225),
    });
  });

  it('commission and earning always add up to the fare, in whole kobo', () => {
    for (const fare of [1, 3, 333, 250_001, 1_180_000, 999_999]) {
      for (const bps of [1500, 2000]) {
        const split = splitFare(fare, bps);
        expect(Number.isSafeInteger(split.commissionKobo)).toBe(true);
        expect(split.commissionKobo + split.driverEarningKobo).toBe(fare);
      }
    }
  });

  it('rounds commission to the nearest kobo, halves going up', () => {
    expect(splitFare(10, 1500).commissionKobo).toBe(2); // 1.5 -> 2
    expect(splitFare(9, 1500).commissionKobo).toBe(1); // 1.35 -> 1
  });

  it('refuses non-integer fares and bad rates', () => {
    expect(() => splitFare(100.5, 1500)).toThrow(RangeError);
    expect(() => splitFare(100, 10_001)).toThrow(PricingError);
  });
});

describe('Money helpers', () => {
  it('formats kobo as naira', () => {
    expect(formatNaira(naira(11_800))).toBe('₦11,800');
    expect(formatNaira(150)).toBe('₦1.50');
  });

  it('refuses part naira in naira()', () => {
    expect(() => naira(1.5)).toThrow(RangeError);
  });
});

describe('Defaults match database/schema.sql pricing_rules', () => {
  it('has the CLAUDE.md numbers', () => {
    expect(DEFAULT_PRICING_RULE).toMatchObject({
      hourlyRateKobo: naira(3_500),
      minHours: 2,
      soloBaseKobo: naira(2_500),
      soloPerKmKobo: naira(300),
      soloRoundingKobo: naira(100),
      nightSurchargeKobo: naira(1_500),
      nightStartMinute: 21 * 60,
      nightEndMinute: 5 * 60,
      commissionFirstYearBps: 1500,
      commissionAfterBps: 2000,
      firstYearMonths: 12,
    });
  });
});
