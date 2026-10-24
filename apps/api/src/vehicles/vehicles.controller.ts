import { Body, ConflictException, Controller, Get, Inject, Post } from '@nestjs/common';
import { ParsedVehicle, Vehicle, vehicleSchema } from '@driva/shared';
import { Pool } from 'pg';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PG_POOL } from '../database/database.module';

const MAX_VEHICLES = 10;

interface VehicleRow {
  id: string;
  make_model: string;
  plate_number: string;
  colour: string | null;
  transmission: Vehicle['transmission'];
}

const toVehicle = (r: VehicleRow): Vehicle => ({
  id: r.id,
  makeModel: r.make_model,
  plateNumber: r.plate_number,
  colour: r.colour,
  transmission: r.transmission,
});

/** A personal client's own cars. Business fleet cars come with business accounts in Step 9. */
@Roles('client')
@Controller('vehicles')
export class VehiclesController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<Vehicle[]> {
    const { rows } = await this.pool.query<VehicleRow>(
      `SELECT id, make_model, plate_number, colour, transmission FROM vehicles
       WHERE owner_user_id = $1 ORDER BY created_at`,
      [user.id],
    );
    return rows.map(toVehicle);
  }

  @Post()
  async add(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(vehicleSchema)) body: ParsedVehicle,
  ): Promise<Vehicle> {
    const { rows } = await this.pool.query<VehicleRow>(
      `INSERT INTO vehicles (owner_user_id, make_model, plate_number, colour, transmission)
       SELECT $1, $2, $3, $4, $5
       WHERE (SELECT count(*) FROM vehicles WHERE owner_user_id = $1) < $6
       RETURNING id, make_model, plate_number, colour, transmission`,
      [
        user.id,
        body.makeModel,
        body.plateNumber,
        body.colour ?? null,
        body.transmission,
        MAX_VEHICLES,
      ],
    );
    if (!rows[0]) throw new ConflictException(`You can save up to ${MAX_VEHICLES} cars`);
    return toVehicle(rows[0]);
  }
}
