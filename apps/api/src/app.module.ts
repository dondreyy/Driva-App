import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { DriversModule } from './drivers/drivers.module';
import { EventsModule } from './events/events.module';
import { HealthController } from './health/health.controller';
import { MapsModule } from './maps/maps.module';
import { MatchingModule } from './matching/matching.module';
import { QuotesModule } from './quotes/quotes.module';
import { StorageModule } from './storage/storage.module';
import { TripsModule } from './trips/trips.module';
import { UsersModule } from './users/users.module';
import { VehiclesController } from './vehicles/vehicles.controller';
import { VettingModule } from './vetting/vetting.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    // In memory for now. Moves to Redis when the API runs on more than one server.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      // Jest sets NODE_ENV=test. The throttling test switches it off to check the limits.
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    StorageModule,
    AuthModule,
    UsersModule,
    DriversModule,
    VettingModule,
    MapsModule,
    QuotesModule,
    MatchingModule,
    TripsModule,
    EventsModule,
  ],
  controllers: [HealthController, VehiclesController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
