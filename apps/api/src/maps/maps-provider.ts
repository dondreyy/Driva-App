import type { LatLng, Place, PlaceSuggestion } from '@driva/shared';

export const MAPS_PROVIDER = Symbol('MAPS_PROVIDER');

export interface Route {
  distanceMeters: number;
  durationSeconds: number;
  /** Points along the road route, for the planned route and deviation alerts later. */
  path: LatLng[];
}

/** Place search and driving routes. Google in production, behind an interface for tests. */
export interface MapsProvider {
  search(
    query: string,
    near: LatLng | null,
    sessionToken: string | undefined,
  ): Promise<PlaceSuggestion[]>;
  details(placeId: string, sessionToken: string | undefined): Promise<Place | null>;
  reverse(at: LatLng): Promise<Place | null>;
  route(from: LatLng, to: LatLng): Promise<Route | null>;
}

/** Decodes a Google encoded polyline into points. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const axis of ['lat', 'lng'] as const) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 'lat') lat += delta;
      else lng += delta;
    }
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}
