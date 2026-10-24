import { describe, expect, it } from 'vitest';
import {
  canGoOnline,
  DriverApplication,
  driverGuarantorsSchema,
  driverProfileSchema,
  isVettingCurrent,
  missingForSubmission,
  vettingResultSchema,
} from './drivers';

const CITY = '7d9f8a2e-3c1b-4c55-9a7e-1f2d3c4b5a69';

describe('Vetting is valid for 12 months', () => {
  const vetted = new Date('2026-05-10T10:00:00Z');

  it('is current until 12 months after the last full vetting', () => {
    expect(isVettingCurrent(vetted, new Date('2027-05-10T09:59:59Z'))).toBe(true);
    expect(isVettingCurrent(vetted, new Date('2027-05-10T10:00:00Z'))).toBe(false);
  });

  it('is never current without a vetting date', () => {
    expect(isVettingCurrent(null, vetted)).toBe(false);
  });
});

describe('Only approved drivers with current vetting can go online', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  const recent = new Date('2026-10-01T00:00:00Z');

  it.each(['applied', 'in_vetting', 'rejected', 'suspended'] as const)(
    'refuses a %s driver',
    (status) => {
      expect(canGoOnline({ status, lastFullVettingAt: recent }, now)).toBe(false);
    },
  );

  it('allows an approved driver vetted in the last 12 months', () => {
    expect(canGoOnline({ status: 'approved', lastFullVettingAt: recent }, now)).toBe(true);
  });

  it('refuses an approved driver whose vetting is over 12 months old', () => {
    expect(
      canGoOnline({ status: 'approved', lastFullVettingAt: new Date('2025-10-31T00:00:00Z') }, now),
    ).toBe(false);
  });
});

describe('driverProfileSchema', () => {
  it('cleans up the NIN and licence number', () => {
    expect(
      driverProfileSchema.parse({
        cityId: CITY,
        nin: '123 4567 8901',
        licenceNumber: 'abc-12345aa12',
        yearsDriving: '4 to 7 years',
      }),
    ).toEqual({
      cityId: CITY,
      nin: '12345678901',
      licenceNumber: 'ABC12345AA12',
      yearsDriving: '4 to 7 years',
    });
  });

  it.each(['1234567890', '123456789012', '1234567890a'])('refuses NIN %s', (nin) => {
    expect(
      driverProfileSchema.safeParse({
        cityId: CITY,
        nin,
        licenceNumber: 'ABC12345AA12',
        yearsDriving: '4 to 7 years',
      }).success,
    ).toBe(false);
  });
});

describe('driverGuarantorsSchema', () => {
  const g = (phone: string) => ({
    fullName: 'Ngozi Eze',
    phone,
    relationship: 'Former employer, runs a pharmacy',
    address: '12 Admiralty Way, Lekki',
  });

  it('needs two different guarantors and the driver’s confirmation', () => {
    expect(
      driverGuarantorsSchema.safeParse({
        guarantors: [g('08035550001'), g('08035550002')],
        confirmRules: true,
      }).success,
    ).toBe(true);
    expect(
      driverGuarantorsSchema.safeParse({
        guarantors: [g('08035550001'), g('0803 555 0001')],
        confirmRules: true,
      }).success,
    ).toBe(false);
    expect(
      driverGuarantorsSchema.safeParse({ guarantors: [g('08035550001'), g('08035550002')] })
        .success,
    ).toBe(false);
    expect(
      driverGuarantorsSchema.safeParse({ guarantors: [g('08035550001')], confirmRules: true })
        .success,
    ).toBe(false);
  });
});

describe('vettingResultSchema', () => {
  it('needs a reason to fail a check', () => {
    expect(vettingResultSchema.safeParse({ status: 'failed' }).success).toBe(false);
    expect(
      vettingResultSchema.safeParse({ status: 'failed', note: 'Address does not exist' }).success,
    ).toBe(true);
    expect(vettingResultSchema.safeParse({ status: 'passed' }).success).toBe(true);
  });
});

describe('missingForSubmission', () => {
  const complete: DriverApplication = {
    status: 'applied',
    cityId: CITY,
    hasProfile: true,
    yearsDriving: '8 years or more',
    homeAddress: '4 Bourdillon Road',
    guarantorCount: 2,
    documents: ['licence', 'nin', 'passport_photo', 'selfie'],
    consentsGiven: true,
    submittedAt: null,
    approvedAt: null,
    canGoOnline: false,
    vetting: [],
  };

  it('is empty when everything is there', () => {
    expect(missingForSubmission(complete)).toEqual([]);
  });

  it('lists what is missing', () => {
    expect(
      missingForSubmission({
        ...complete,
        documents: ['licence'],
        guarantorCount: 1,
        consentsGiven: false,
      }),
    ).toEqual([
      'NIN slip or card',
      'Passport photograph',
      'Selfie',
      'Two guarantors',
      'Your consent to the checks',
    ]);
  });
});
