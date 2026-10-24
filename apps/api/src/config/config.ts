export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  /** Signs access and sign-up tokens. At least 32 characters. */
  jwtSecret: string;
  /** Mixed into OTP hashes so a database leak does not reveal codes. At least 32 characters. */
  otpPepper: string;
  sms:
    | { provider: 'console' }
    | { provider: 'termii'; apiKey: string; senderId: string; baseUrl: string };
  /** AES-256 key for NINs, licence numbers and bank details at rest. */
  dataEncryptionKey: Buffer;
  storage:
    | { provider: 'local'; dir: string; publicUrl: string }
    | { provider: 's3'; bucket: string; region: string };
  maps: { provider: 'dev' } | { provider: 'google'; apiKey: string };
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const production = nodeEnv === 'production';

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT must be a positive integer, got ${env.PORT}`);
  }

  const provider = env.SMS_PROVIDER ?? (production ? 'termii' : 'console');
  let sms: AppConfig['sms'];
  if (provider === 'console') {
    // The console sender prints login codes. It must never run in production.
    if (production) throw new Error('SMS_PROVIDER=console is not allowed in production');
    sms = { provider };
  } else if (provider === 'termii') {
    sms = {
      provider,
      apiKey: required(env, 'TERMII_API_KEY'),
      senderId: required(env, 'TERMII_SENDER_ID'),
      baseUrl: env.TERMII_BASE_URL ?? 'https://api.ng.termii.com',
    };
  } else {
    throw new Error(`SMS_PROVIDER must be console or termii, got ${provider}`);
  }

  const storageProvider = env.STORAGE_PROVIDER ?? (production ? 's3' : 'local');
  let storage: AppConfig['storage'];
  if (storageProvider === 'local') {
    // Files on the API server's disk. Fine for development and tests, never for production.
    if (production) throw new Error('STORAGE_PROVIDER=local is not allowed in production');
    storage = {
      provider: 'local',
      dir: env.STORAGE_LOCAL_DIR ?? '.storage',
      publicUrl: (env.PUBLIC_API_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    };
  } else if (storageProvider === 's3') {
    storage = {
      provider: 's3',
      bucket: required(env, 'S3_BUCKET'),
      region: required(env, 'AWS_REGION'),
    };
  } else {
    throw new Error(`STORAGE_PROVIDER must be local or s3, got ${storageProvider}`);
  }

  const mapsProvider = env.MAPS_PROVIDER ?? (production ? 'google' : 'dev');
  let maps: AppConfig['maps'];
  if (mapsProvider === 'dev') {
    // Sample places and straight line distances. Prices from it are not real, so never in production.
    if (production) throw new Error('MAPS_PROVIDER=dev is not allowed in production');
    maps = { provider: 'dev' };
  } else if (mapsProvider === 'google') {
    maps = { provider: 'google', apiKey: required(env, 'GOOGLE_MAPS_API_KEY') };
  } else {
    throw new Error(`MAPS_PROVIDER must be dev or google, got ${mapsProvider}`);
  }

  const dataEncryptionKey = Buffer.from(required(env, 'DATA_ENCRYPTION_KEY'), 'base64');
  if (dataEncryptionKey.length !== 32) {
    throw new Error(
      'DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)',
    );
  }

  return {
    nodeEnv,
    port,
    databaseUrl: required(env, 'DATABASE_URL'),
    jwtSecret: secret(env, 'JWT_SECRET'),
    otpPepper: secret(env, 'OTP_PEPPER'),
    sms,
    dataEncryptionKey,
    storage,
    maps,
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function secret(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  if (value.length < 32) throw new Error(`${name} must be at least 32 characters`);
  return value;
}
