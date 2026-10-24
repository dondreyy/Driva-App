import { loadConfig } from './config';

const base = {
  DATABASE_URL: 'postgres://x',
  JWT_SECRET: 'j'.repeat(32),
  OTP_PEPPER: 'p'.repeat(32),
};

describe('loadConfig', () => {
  it('reads the environment', () => {
    expect(loadConfig({ ...base, PORT: '4000' })).toEqual({
      nodeEnv: 'development',
      port: 4000,
      databaseUrl: 'postgres://x',
      jwtSecret: base.JWT_SECRET,
      otpPepper: base.OTP_PEPPER,
      sms: { provider: 'console' },
    });
  });

  it('fails fast without DATABASE_URL', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('refuses short secrets', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('never prints login codes in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', SMS_PROVIDER: 'console' })).toThrow(
      /not allowed in production/,
    );
  });

  it('uses Termii in production and needs its key', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/TERMII_API_KEY/);
    expect(
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        TERMII_API_KEY: 'k',
        TERMII_SENDER_ID: 'Driva',
      }).sms,
    ).toEqual({
      provider: 'termii',
      apiKey: 'k',
      senderId: 'Driva',
      baseUrl: 'https://api.ng.termii.com',
    });
  });
});
