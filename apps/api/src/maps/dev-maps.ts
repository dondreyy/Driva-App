import type { LatLng, Place, PlaceSuggestion } from '@driva/shared';
import { MapsProvider, Route } from './maps-provider';

/**
 * Development only, so the apps work without a Google key. A few sample places and straight
 * line distances times 1.3 for roads. Config refuses it in production.
 */
const SAMPLE_PLACES: (Place & { id: string; subtitle: string })[] = [
  {
    id: 'dev-lekki-1',
    label: 'Lekki Phase 1',
    subtitle: 'Admiralty Way, Lekki',
    lat: 6.4478,
    lng: 3.4723,
  },
  {
    id: 'dev-vi',
    label: 'Victoria Island',
    subtitle: 'Adeola Odeku Street',
    lat: 6.4281,
    lng: 3.4219,
  },
  { id: 'dev-ikoyi', label: 'Ikoyi', subtitle: 'Awolowo Road', lat: 6.4549, lng: 3.4246 },
  { id: 'dev-ajah', label: 'Ajah', subtitle: 'Lekki-Epe Expressway', lat: 6.4698, lng: 3.5852 },
  { id: 'dev-ikeja', label: 'Ikeja GRA', subtitle: 'Mainland', lat: 6.5833, lng: 3.35 },
  {
    id: 'dev-airport',
    label: 'Murtala Muhammed Airport',
    subtitle: 'International terminal, Ikeja',
    lat: 6.5774,
    lng: 3.3212,
  },
];

const ROAD_FACTOR = 1.3;

export function straightLineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export class DevMapsProvider implements MapsProvider {
  async search(query: string): Promise<PlaceSuggestion[]> {
    const q = query.trim().toLowerCase();
    return SAMPLE_PLACES.filter((p) => `${p.label} ${p.subtitle}`.toLowerCase().includes(q)).map(
      (p) => ({
        placeId: p.id,
        title: p.label,
        subtitle: p.subtitle,
      }),
    );
  }

  async details(placeId: string): Promise<Place | null> {
    const p = SAMPLE_PLACES.find((s) => s.id === placeId);
    return p ? { label: p.label, lat: p.lat, lng: p.lng } : null;
  }

  async reverse(at: LatLng): Promise<Place | null> {
    const nearest = [...SAMPLE_PLACES].sort(
      (a, b) => straightLineMeters(at, a) - straightLineMeters(at, b),
    )[0];
    return nearest ? { label: `Near ${nearest.label}`, lat: at.lat, lng: at.lng } : null;
  }

  async route(from: LatLng, to: LatLng): Promise<Route> {
    const distanceMeters = Math.round(straightLineMeters(from, to) * ROAD_FACTOR);
    // About 25 km/h in Lagos traffic.
    return { distanceMeters, durationSeconds: Math.round(distanceMeters / 7), path: [from, to] };
  }
}
