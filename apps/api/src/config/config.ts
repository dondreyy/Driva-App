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

  return {
    nodeEnv,
    port,
    databaseUrl: required(env, 'DATABASE_URL'),
    jwtSecret: secret(env, 'JWT_SECRET'),
    otpPepper: secret(env, 'OTP_PEPPER'),
    sms,
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
