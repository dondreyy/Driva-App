import { Controller, Get, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { Public } from '../auth/decorators';
import { PG_POOL } from '../database/database.module';

@Public()
@Controller('cities')
export class CitiesController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Cities open for bookings and driver sign up. */
  @Get()
  async live(): Promise<{ id: string; name: string }[]> {
    const { rows } = await this.pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM cities WHERE is_live ORDER BY name`,
    );
    return rows;
  }
}
