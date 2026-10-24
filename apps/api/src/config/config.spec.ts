import { loadConfig } from './config';

const base = {
  DATABASE_URL: 'postgres://x',
  JWT_SECRET: 'j'.repeat(32),
  OTP_PEPPER: 'p'.repeat(32),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
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
      dataEncryptionKey: Buffer.alloc(32, 7),
      storage: { provider: 'local', dir: '.storage', publicUrl: 'http://localhost:4000' },
      maps: { provider: 'dev' },
      matchingWorker: true,
      publicWebUrl: 'http://localhost:8081',
      corsOrigins: [],
    });
  });

  it('fails fast without DATABASE_URL', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('refuses short secrets', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('never prints login codes in production', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        SMS_PROVIDER: 'console',
        S3_BUCKET: 'b',
        AWS_REGION: 'r',
      }),
    ).toThrow(/not allowed in production/);
  });

  it('refuses a data encryption key that is not 32 bytes', () => {
    expect(() => loadConfig({ ...base, DATA_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(/32 bytes/);
  });

  it('keeps files on S3 in production, never on local disk', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      TERMII_API_KEY: 'k',
      TERMII_SENDER_ID: 'Driva',
      GOOGLE_MAPS_API_KEY: 'g',
    };
    expect(() => loadConfig({ ...prod, STORAGE_PROVIDER: 'local' })).toThrow(
      /not allowed in production/,
    );
    expect(() => loadConfig(prod)).toThrow(/S3_BUCKET/);
    expect(
      loadConfig({ ...prod, S3_BUCKET: 'driva-files', AWS_REGION: 'af-south-1' }).storage,
    ).toEqual({
      provider: 's3',
      bucket: 'driva-files',
      region: 'af-south-1',
    });
  });

  it('prices with Google in production, never the development maps', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      S3_BUCKET: 'b',
      AWS_REGION: 'af-south-1',
      TERMII_API_KEY: 'k',
      TERMII_SENDER_ID: 'Driva',
    };
    expect(() => loadConfig({ ...prod, MAPS_PROVIDER: 'dev' })).toThrow(
      /not allowed in production/,
    );
    expect(() => loadConfig(prod)).toThrow(/GOOGLE_MAPS_API_KEY/);
    expect(loadConfig({ ...prod, GOOGLE_MAPS_API_KEY: 'g' }).maps).toEqual({
      provider: 'google',
      apiKey: 'g',
    });
  });

  it('uses Termii in production and needs its key', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      S3_BUCKET: 'b',
      AWS_REGION: 'af-south-1',
      GOOGLE_MAPS_API_KEY: 'g',
    };
    expect(() => loadConfig(prod)).toThrow(/TERMII_API_KEY/);
    expect(
      loadConfig({
        ...prod,
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
