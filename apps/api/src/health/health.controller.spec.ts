import { ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports ok when the database answers', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;
    await expect(new HealthController(pool).check()).resolves.toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it('returns 503 when the database is down', async () => {
    const pool = { query: jest.fn().mockRejectedValue(new Error('refused')) } as unknown as Pool;
    await expect(new HealthController(pool).check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
