import { Module } from '@nestjs/common';
import { CitiesController } from '../cities/cities.controller';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';

@Module({
  controllers: [DriversController, CitiesController],
  providers: [DriversService],
})
export class DriversModule {}
