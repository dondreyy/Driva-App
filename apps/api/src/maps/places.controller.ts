import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { latLngSchema, Place, PlaceSuggestion } from '@driva/shared';
import { Roles } from '../auth/decorators';
import { MAPS_PROVIDER, MapsProvider } from './maps-provider';

function point(lat?: string, lng?: string) {
  if (lat === undefined && lng === undefined) return null;
  const parsed = latLngSchema.safeParse({ lat: Number(lat), lng: Number(lng) });
  if (!parsed.success) throw new BadRequestException('lat and lng must be valid coordinates');
  return parsed.data;
}

/** Place search for the booking screen. Goes through the API so the Google key stays private. */
@Roles('client')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('places')
export class PlacesController {
  constructor(@Inject(MAPS_PROVIDER) private readonly maps: MapsProvider) {}

  @Get('search')
  search(
    @Query('q') q = '',
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('session') session?: string,
  ): Promise<PlaceSuggestion[]> {
    const query = q.trim();
    if (query.length < 2 || query.length > 100)
      throw new BadRequestException('Type at least 2 letters');
    return this.call(() => this.maps.search(query, point(lat, lng), session));
  }

  @Get('details/:placeId')
  async details(
    @Param('placeId') placeId: string,
    @Query('session') session?: string,
  ): Promise<Place> {
    const place = await this.call(() => this.maps.details(placeId, session));
    if (!place) throw new NotFoundException('Place not found');
    return place;
  }

  @Get('reverse')
  async reverse(@Query('lat') lat?: string, @Query('lng') lng?: string): Promise<Place> {
    const at = point(lat, lng);
    if (!at) throw new BadRequestException('lat and lng are required');
    const place = await this.call(() => this.maps.reverse(at));
    if (!place) throw new NotFoundException('No address found here');
    return place;
  }

  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch {
      throw new ServiceUnavailableException('Maps are not available right now. Try again.');
    }
  }
}
