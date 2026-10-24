import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Encrypts sensitive fields (NIN, licence number, bank account) with AES-256-GCM before they
 * are stored. Stored layout: version byte, IV, auth tag, ciphertext.
 */
@Injectable()
export class FieldEncryption {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  encrypt(plain: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.config.dataEncryptionKey, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
  }

  decrypt(stored: Buffer): string {
    if (stored[0] !== VERSION) throw new Error('Unknown encryption version');
    const iv = stored.subarray(1, 1 + IV_BYTES);
    const tag = stored.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const body = stored.subarray(1 + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.config.dataEncryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  }

  /** Keyed hash for finding duplicates (same NIN twice) without storing the value in clear. */
  lookupHash(purpose: string, value: string): string {
    return createHmac('sha256', this.config.dataEncryptionKey)
      .update(`${purpose}:${value}`)
      .digest('hex');
  }
}

/** "12345678901" -> "********901" */
export function maskTail(value: string, visible = 3): string {
  return '*'.repeat(Math.max(0, value.length - visible)) + value.slice(-visible);
}
