import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { LocalFileStorage, S3FileStorage } from './file-storage';

describe('LocalFileStorage', () => {
  let storage: LocalFileStorage;

  beforeAll(async () => {
    storage = new LocalFileStorage(
      await mkdtemp(join(tmpdir(), 'driva-')),
      'http://api.test',
      's'.repeat(32),
    );
  });

  it('signs upload links for one key and content type', async () => {
    const ticket = await storage.createUpload('drivers/u1/licence/a.jpg', 'image/jpeg');
    const token = ticket.url.split('/').pop()!;
    expect(storage.verify(token, 'put')).toMatchObject({
      key: 'drivers/u1/licence/a.jpg',
      ct: 'image/jpeg',
    });
    expect(storage.verify(token, 'get')).toBeNull();
  });

  it('rejects a tampered token', async () => {
    const url = await storage.createDownloadUrl('drivers/u1/licence/a.jpg');
    const [payload, sig] = url.split('/').pop()!.split('.');
    const forged = Buffer.from(
      JSON.stringify({ op: 'get', key: 'drivers/u2/nin/b.jpg', exp: 9e9 }),
    ).toString('base64url');
    expect(storage.verify(`${forged}.${sig}`, 'get')).toBeNull();
    expect(storage.verify(`${payload}.${sig}`, 'get')).not.toBeNull();
  });

  it('refuses keys that escape the storage folder', () => {
    expect(() => storage.pathFor('../../etc/passwd')).toThrow();
  });

  it('writes and finds files', async () => {
    expect(await storage.exists('x/y.jpg')).toBe(false);
    await storage.write('x/y.jpg', Buffer.from('jpeg'));
    expect(await storage.exists('x/y.jpg')).toBe(true);
  });
});

describe('S3FileStorage', () => {
  const s3 = new S3Client({
    region: 'af-south-1',
    credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
  });
  const storage = new S3FileStorage('driva-files', 'af-south-1', s3);

  it('makes short lived presigned upload and download URLs', async () => {
    const ticket = await storage.createUpload('drivers/u1/nin/a.jpg', 'image/jpeg');
    expect(ticket.url).toMatch(
      /^https:\/\/driva-files\.s3\.af-south-1\.amazonaws\.com\/drivers\/u1\/nin\/a\.jpg\?/,
    );
    expect(ticket.url).toContain('X-Amz-Expires=600');
    expect(ticket.url).toContain('X-Amz-Signature=');
    const download = await storage.createDownloadUrl('drivers/u1/nin/a.jpg');
    expect(download).toContain('X-Amz-Expires=300');
  });
});
