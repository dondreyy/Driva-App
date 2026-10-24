import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { DevMapsProvider } from './dev-maps';
import { GoogleMapsProvider } from './google-maps';
import { MAPS_PROVIDER } from './maps-provider';
import { PlacesController } from './places.controller';

@Global()
@Module({
  controllers: [PlacesController],
  providers: [
    {
      provide: MAPS_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.maps.provider === 'google'
          ? new GoogleMapsProvider(config.maps.apiKey)
          : new DevMapsProvider(),
    },
  ],
  exports: [MAPS_PROVIDER],
})
export class MapsModule {}
