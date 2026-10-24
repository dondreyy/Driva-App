import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import {
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MAX_UPLOAD_BYTES, UploadTicket } from '@driva/shared';
import { AppConfig } from '../config/config';

export const FILE_STORAGE = Symbol('FILE_STORAGE');

export const UPLOAD_URL_TTL_SECONDS = 10 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

/**
 * Private file storage. Nothing is public: every upload and download goes through a short
 * lived signed URL.
 */
export interface FileStorage {
  createUpload(key: string, contentType: string): Promise<UploadTicket>;
  createDownloadUrl(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
}

export class S3FileStorage implements FileStorage {
  private readonly s3: S3Client;

  constructor(
    private readonly bucket: string,
    region: string,
    client?: S3Client,
  ) {
    this.s3 = client ?? new S3Client({ region });
  }

  async createUpload(key: string, contentType: string): Promise<UploadTicket> {
    const url = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
    return {
      key,
      url,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    };
  }

  createDownloadUrl(key: string): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    });
  }

  async exists(key: string): Promise<boolean> {
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return (head.ContentLength ?? 0) > 0 && (head.ContentLength ?? 0) <= MAX_UPLOAD_BYTES;
    } catch {
      return false;
    }
  }
}

interface LocalGrant {
  op: 'put' | 'get';
  key: string;
  exp: number;
  ct?: string;
}

/**
 * Development and test storage on the API server's disk. The API serves the files itself at
 * /v1/files/:token, where the token is an HMAC signed, expiring grant for one key.
 */
export class LocalFileStorage implements FileStorage {
  constructor(
    private readonly dir: string,
    private readonly publicUrl: string,
    private readonly secret: string,
  ) {}

  async createUpload(key: string, contentType: string): Promise<UploadTicket> {
    const token = this.sign({
      op: 'put',
      key,
      ct: contentType,
      exp: now() + UPLOAD_URL_TTL_SECONDS,
    });
    return {
      key,
      url: `${this.publicUrl}/v1/files/${token}`,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    };
  }

  async createDownloadUrl(key: string): Promise<string> {
    return `${this.publicUrl}/v1/files/${this.sign({ op: 'get', key, exp: now() + DOWNLOAD_URL_TTL_SECONDS })}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.pathFor(key))).size > 0;
    } catch {
      return false;
    }
  }

  /** Returns the grant if the token is genuine, unexpired and for `op`. */
  verify(token: string, op: LocalGrant['op']): LocalGrant | null {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = this.mac(payload);
    if (
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return null;
    }
    const grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LocalGrant;
    return grant.op === op && grant.exp > now() ? grant : null;
  }

  async write(key: string, body: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  pathFor(key: string): string {
    const root = resolve(this.dir);
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error('Invalid storage key');
    return path;
  }

  private sign(grant: LocalGrant): string {
    const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
    return `${payload}.${this.mac(payload)}`;
  }

  private mac(payload: string): string {
    return createHmac('sha256', `files:${this.secret}`).update(payload).digest('base64url');
  }
}

export function createFileStorage(config: AppConfig): FileStorage {
  return config.storage.provider === 's3'
    ? new S3FileStorage(config.storage.bucket, config.storage.region)
    : new LocalFileStorage(config.storage.dir, config.storage.publicUrl, config.jwtSecret);
}

const now = () => Math.floor(Date.now() / 1000);
