import { Logger } from '@nestjs/common';
import type { LatLng, Place, PlaceSuggestion } from '@driva/shared';
import { decodePolyline, MapsProvider, Route } from './maps-provider';

type FetchLike = typeof fetch;

/** How far around the user to favour search results. */
const SEARCH_BIAS_METERS = 30_000;

/**
 * Google Maps Platform: Places API (New) for search, the Geocoding API for "where am I", and
 * the Routes API for road distance. The key stays on the server.
 */
export class GoogleMapsProvider implements MapsProvider {
  private readonly logger = new Logger('GoogleMaps');

  constructor(
    private readonly apiKey: string,
    private readonly http: FetchLike = fetch,
  ) {}

  async search(
    query: string,
    near: LatLng | null,
    sessionToken?: string,
  ): Promise<PlaceSuggestion[]> {
    const data = await this.post<{
      suggestions?: {
        placePrediction?: {
          placeId: string;
          structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } };
          text?: { text: string };
        };
      }[];
    }>('https://places.googleapis.com/v1/places:autocomplete', {
      input: query,
      includedRegionCodes: ['ng'],
      ...(sessionToken ? { sessionToken } : {}),
      ...(near
        ? {
            locationBias: {
              circle: {
                center: { latitude: near.lat, longitude: near.lng },
                radius: SEARCH_BIAS_METERS,
              },
            },
          }
        : {}),
    });
    return (data.suggestions ?? []).flatMap((s) => {
      const p = s.placePrediction;
      if (!p) return [];
      return [
        {
          placeId: p.placeId,
          title: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
          subtitle: p.structuredFormat?.secondaryText?.text ?? '',
        },
      ];
    });
  }

  async details(placeId: string, sessionToken?: string): Promise<Place | null> {
    const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
    if (sessionToken) url.searchParams.set('sessionToken', sessionToken);
    const res = await this.http(url, {
      headers: { 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': 'displayName,location' },
    });
    if (res.status === 404) return null;
    const data = (await this.read(res, 'place details')) as {
      displayName?: { text: string };
      location?: { latitude: number; longitude: number };
    };
    if (!data.location) return null;
    return {
      label: data.displayName?.text ?? 'Selected place',
      lat: data.location.latitude,
      lng: data.location.longitude,
    };
  }

  async reverse(at: LatLng): Promise<Place | null> {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${at.lat},${at.lng}`);
    url.searchParams.set('key', this.apiKey);
    const data = (await this.read(await this.http(url), 'reverse geocode')) as {
      status: string;
      results?: { formatted_address: string }[];
    };
    const first = data.results?.[0];
    if (data.status !== 'OK' || !first) return null;
    // "12 Admiralty Way, Lekki Phase 1, Lagos 106104, Lagos, Nigeria" -> first two parts.
    const label = first.formatted_address.split(',').slice(0, 2).join(',').trim();
    return { label, lat: at.lat, lng: at.lng };
  }

  async route(from: LatLng, to: LatLng): Promise<Route | null> {
    const data = await this.post<{
      routes?: {
        distanceMeters?: number;
        duration?: string;
        polyline?: { encodedPolyline?: string };
      }[];
    }>(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: 'DRIVE',
        // Traffic-unaware: the same trip gets the same price at any hour.
        routingPreference: 'TRAFFIC_UNAWARE',
      },
      'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    );
    const route = data.routes?.[0];
    if (!route?.distanceMeters) return null;
    return {
      distanceMeters: route.distanceMeters,
      durationSeconds: Number.parseInt(route.duration ?? '0', 10),
      path: route.polyline?.encodedPolyline ? decodePolyline(route.polyline.encodedPolyline) : [],
    };
  }

  private async post<T>(url: string, body: unknown, fieldMask?: string): Promise<T> {
    const res = await this.http(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}),
      },
      body: JSON.stringify(body),
    });
    return (await this.read(res, url.split('/').pop() ?? 'request')) as T;
  }

  private async read(res: Response, what: string): Promise<unknown> {
    if (!res.ok) {
      // Never log the request: it can hold the user's location.
      this.logger.error(`Google ${what} failed with status ${res.status}`);
      throw new Error('Maps service unavailable');
    }
    return res.json();
  }
}
