import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './api-client';
import { otpVerifySchema, signupSchema, updateMeSchema } from './auth';
import { formatNigerianPhone, maskPhone, normalizeNigerianPhone } from './phone';

describe('normalizeNigerianPhone', () => {
  it.each([
    ['08035550142', '+2348035550142'],
    ['0803 555 0142', '+2348035550142'],
    ['+234 803 555 0142', '+2348035550142'],
    ['2348035550142', '+2348035550142'],
    ['0703-555-0142', '+2347035550142'],
    ['09065550142', '+2349065550142'],
    ['08135550142', '+2348135550142'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeNigerianPhone(input)).toBe(expected);
  });

  it.each(['', '0803555014', '080355501421', '01234567890', '+447700900123', 'abc'])(
    'rejects %j',
    (input) => {
      expect(normalizeNigerianPhone(input)).toBeNull();
    },
  );
});

describe('phone display', () => {
  it('masks all but the last four digits', () => {
    expect(maskPhone('+2348035550142')).toBe('+*********0142');
  });

  it('formats for the owner', () => {
    expect(formatNigerianPhone('+2348035550142')).toBe('0803 555 0142');
  });
});

describe('request schemas', () => {
  it('normalizes the phone and checks the code', () => {
    expect(
      otpVerifySchema.parse({ phone: '0803 555 0142', code: '123456', app: 'client' }),
    ).toEqual({ phone: '+2348035550142', code: '123456', app: 'client' });
    expect(() => otpVerifySchema.parse({ phone: '0803', code: '123456', app: 'client' })).toThrow();
    expect(() =>
      otpVerifySchema.parse({ phone: '08035550142', code: '1234', app: 'client' }),
    ).toThrow();
    expect(() =>
      otpVerifySchema.parse({ phone: '08035550142', code: '123456', app: 'admin' }),
    ).toThrow();
  });

  it('requires consent to sign up', () => {
    const base = { signupToken: 't', fullName: 'Tolu Adebayo' };
    expect(signupSchema.safeParse({ ...base, consent: true }).success).toBe(true);
    expect(signupSchema.safeParse({ ...base, consent: false }).success).toBe(false);
    expect(signupSchema.safeParse(base).success).toBe(false);
  });

  it('needs both parts of an emergency contact or neither', () => {
    const base = { signupToken: 't', fullName: 'Tolu Adebayo', consent: true };
    expect(signupSchema.safeParse({ ...base, emergencyContactName: 'Bimpe' }).success).toBe(false);
    expect(
      signupSchema.safeParse({
        ...base,
        emergencyContactName: 'Bimpe Adebayo',
        emergencyContactPhone: '0807 555 0190',
      }).success,
    ).toBe(true);
  });

  it('refuses unknown fields so nobody can set their own role', () => {
    expect(updateMeSchema.safeParse({ role: 'admin' }).success).toBe(false);
  });
});

describe('createApiClient', () => {
  it('sends JSON to /v1 with the bearer token', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'u1' }) });
    const api = createApiClient({
      baseUrl: 'https://api.test/',
      fetch,
      getAccessToken: () => 'tok',
    });
    await expect(api.me()).resolves.toEqual({ id: 'u1' });
    expect(fetch).toHaveBeenCalledWith('https://api.test/v1/me', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer tok' },
      body: undefined,
    });
  });

  it('turns error responses into ApiError with the server message', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: ['Enter a Nigerian mobile number'] }),
    });
    const api = createApiClient({ baseUrl: 'https://api.test', fetch });
    await expect(api.requestOtp({ phone: 'x' })).rejects.toEqual(
      new ApiError(400, 'Enter a Nigerian mobile number'),
    );
  });
});
