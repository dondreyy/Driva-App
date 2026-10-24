import { loadConfig } from '../config/config';
import { FieldEncryption, maskTail } from './field-encryption';

const config = loadConfig({
  DATABASE_URL: 'postgres://x',
  JWT_SECRET: 'j'.repeat(32),
  OTP_PEPPER: 'p'.repeat(32),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
});

describe('FieldEncryption', () => {
  const enc = new FieldEncryption(config);

  it('round trips and never stores the plain value', () => {
    const stored = enc.encrypt('12345678901');
    expect(stored.toString('utf8')).not.toContain('12345678901');
    expect(enc.decrypt(stored)).toBe('12345678901');
  });

  it('gives a different ciphertext each time', () => {
    expect(enc.encrypt('same').equals(enc.encrypt('same'))).toBe(false);
  });

  it('detects tampering', () => {
    const stored = enc.encrypt('12345678901');
    stored[stored.length - 1] = stored[stored.length - 1]! ^ 1;
    expect(() => enc.decrypt(stored)).toThrow();
  });

  it('makes stable lookup hashes per purpose', () => {
    expect(enc.lookupHash('nin', '1')).toBe(enc.lookupHash('nin', '1'));
    expect(enc.lookupHash('nin', '1')).not.toBe(enc.lookupHash('licence', '1'));
  });

  it('masks all but the end', () => {
    expect(maskTail('12345678901')).toBe('********901');
  });
});
