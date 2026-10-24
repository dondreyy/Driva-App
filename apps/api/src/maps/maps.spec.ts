import { DevMapsProvider, straightLineMeters } from './dev-maps';
import { GoogleMapsProvider } from './google-maps';
import { decodePolyline } from './maps-provider';

function fakeFetch(responses: unknown[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const http = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = responses.shift();
    return new Response(JSON.stringify(body), { status: body === undefined ? 500 : 200 });
  }) as typeof fetch;
  return { http, calls };
}

describe('GoogleMapsProvider', () => {
  it('asks the Routes API for a traffic-unaware drive and reads the distance', async () => {
    const { http, calls } = fakeFetch([
      {
        routes: [
          {
            distanceMeters: 9_350,
            duration: '1260s',
            polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC' },
          },
        ],
      },
    ]);
    const route = await new GoogleMapsProvider('KEY', http).route(
      { lat: 6.4478, lng: 3.4723 },
      { lat: 6.4281, lng: 3.4219 },
    );
    expect(route).toEqual({
      distanceMeters: 9_350,
      durationSeconds: 1260,
      path: [
        { lat: 38.5, lng: -120.2 },
        { lat: 40.7, lng: -120.95 },
      ],
    });
    expect(calls[0]!.url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('KEY');
    expect(headers['X-Goog-FieldMask']).toContain('routes.distanceMeters');
    expect(JSON.parse(calls[0]!.init!.body as string)).toMatchObject({
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      origin: { location: { latLng: { latitude: 6.4478, longitude: 3.4723 } } },
    });
  });

  it('returns null when Google finds no route', async () => {
    const { http } = fakeFetch([{}]);
    expect(
      await new GoogleMapsProvider('KEY', http).route({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }),
    ).toBeNull();
  });

  it('searches Nigerian places near the user', async () => {
    const { http, calls } = fakeFetch([
      {
        suggestions: [
          {
            placePrediction: {
              placeId: 'abc',
              structuredFormat: {
                mainText: { text: 'Eko Hotel' },
                secondaryText: { text: 'Victoria Island, Lagos' },
              },
            },
          },
        ],
      },
    ]);
    const results = await new GoogleMapsProvider('KEY', http).search(
      'eko',
      { lat: 6.44, lng: 3.47 },
      'session-1',
    );
    expect(results).toEqual([
      { placeId: 'abc', title: 'Eko Hotel', subtitle: 'Victoria Island, Lagos' },
    ]);
    expect(JSON.parse(calls[0]!.init!.body as string)).toMatchObject({
      input: 'eko',
      includedRegionCodes: ['ng'],
      sessionToken: 'session-1',
      locationBias: { circle: { center: { latitude: 6.44, longitude: 3.47 } } },
    });
  });

  it('turns an error from Google into a plain failure', async () => {
    const { http } = fakeFetch([]);
    await expect(
      new GoogleMapsProvider('KEY', http).search('eko', null, undefined),
    ).rejects.toThrow('Maps service unavailable');
  });
});

describe('decodePolyline', () => {
  it('decodes Google’s documented example', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });
});

describe('DevMapsProvider', () => {
  it('estimates road distance as 1.3 times the straight line', async () => {
    const a = { lat: 6.4478, lng: 3.4723 };
    const b = { lat: 6.4281, lng: 3.4219 };
    const route = await new DevMapsProvider().route(a, b);
    expect(route.distanceMeters).toBe(Math.round(straightLineMeters(a, b) * 1.3));
  });
});
