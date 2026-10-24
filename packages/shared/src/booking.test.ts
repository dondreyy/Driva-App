import { describe, expect, it } from 'vitest';
import { quoteRequestSchema, vehicleSchema } from './booking';

const pickup = { lat: 6.4478, lng: 3.4723, label: 'Lekki Phase 1' };
const destination = { lat: 6.4281, lng: 3.4219, label: 'Victoria Island' };

describe('quoteRequestSchema', () => {
  it('accepts Ride with me with hours, destination optional', () => {
    expect(
      quoteRequestSchema.safeParse({ tripType: 'ride_with_me', pickup, hours: 3 }).success,
    ).toBe(true);
  });

  it.each([
    [{ tripType: 'ride_with_me', pickup }, 'Choose how many hours'],
    [{ tripType: 'ride_with_me', pickup, hours: 1 }, 'Ride with me is at least 2 hours'],
    [{ tripType: 'ride_with_me', pickup, hours: 13 }, 'Ride with me is at most 12 hours'],
    [{ tripType: 'ride_with_me', pickup, hours: 2.5 }, 'Book whole hours'],
    [{ tripType: 'drive_alone', pickup, task: 'Run an errand' }, 'Choose where the car is going'],
    [{ tripType: 'drive_alone', pickup, destination }, 'Choose what the driver should do'],
    [
      { tripType: 'drive_alone', pickup, destination, task: 'Run an errand', hours: 3 },
      'Drive my car alone is not booked by the hour',
    ],
  ])('refuses %j', (body, message) => {
    const result = quoteRequestSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toContain(message);
  });

  it('accepts Drive my car alone with a destination and a task', () => {
    expect(
      quoteRequestSchema.safeParse({
        tripType: 'drive_alone',
        pickup,
        destination,
        task: 'Take car for service',
        pickupAt: '2026-11-02T22:00:00+01:00',
      }).success,
    ).toBe(true);
  });

  it('refuses unknown fields such as a price', () => {
    expect(
      quoteRequestSchema.safeParse({ tripType: 'ride_with_me', pickup, hours: 2, totalFareKobo: 1 })
        .success,
    ).toBe(false);
  });
});

describe('vehicleSchema', () => {
  it('tidies the plate number', () => {
    expect(
      vehicleSchema.parse({
        makeModel: 'Toyota Camry 2018',
        plateNumber: ' lnd  482 kj ',
        transmission: 'automatic',
      }).plateNumber,
    ).toBe('LND 482 KJ');
  });

  it('needs a plate and a transmission', () => {
    expect(
      vehicleSchema.safeParse({
        makeModel: 'Toyota Camry',
        plateNumber: 'X',
        transmission: 'automatic',
      }).success,
    ).toBe(false);
    expect(
      vehicleSchema.safeParse({ makeModel: 'Toyota Camry', plateNumber: 'LND 482 KJ' }).success,
    ).toBe(false);
  });
});
