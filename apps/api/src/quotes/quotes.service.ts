import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  isNightPickup,
  LatLng,
  MAX_DAYS_AHEAD,
  ParsedQuoteRequest,
  PricingRule,
  QUOTE_TTL_MINUTES,
  quoteFare,
  QuoteView,
  TripType,
} from '@driva/shared';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { MAPS_PROVIDER, MapsProvider, Route } from '../maps/maps-provider';

interface RuleRow {
  id: string;
  hourly_rate_kobo: string;
  min_hours: number;
  solo_base_kobo: string;
  solo_per_km_kobo: string;
  night_surcharge_kobo: string;
  night_start_minute: number;
  night_end_minute: number;
  commission_first_year_bps: number;
  commission_after_bps: number;
}

interface QuoteRow {
  id: string;
  city_id: string;
  trip_type: TripType;
  pickup_label: string;
  pickup_lat: number;
  pickup_lng: number;
  destination_label: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  distance_km: string | null;
  duration_minutes: number | null;
  hours: number | null;
  task: string | null;
  scheduled_for: Date | null;
  is_night: boolean;
  base_fare_kobo: string;
  night_kobo: string;
  total_fare_kobo: string;
  hourly_rate_kobo: string;
  expires_at: Date;
}

const QUOTE_COLUMNS = `q.id, q.city_id, q.trip_type, q.pickup_label,
  ST_Y(q.pickup::geometry) AS pickup_lat, ST_X(q.pickup::geometry) AS pickup_lng,
  q.destination_label, ST_Y(q.destination::geometry) AS destination_lat, ST_X(q.destination::geometry) AS destination_lng,
  q.distance_km, q.duration_minutes, q.hours, q.task, q.scheduled_for, q.is_night,
  q.base_fare_kobo, q.night_kobo, q.total_fare_kobo, r.hourly_rate_kobo, q.expires_at`;

/** Road distances are priced to 0.1 km, the precision bookings store. */
export function metersToPricedKm(meters: number): number {
  return Math.round(meters / 100) / 10;
}

@Injectable()
export class QuotesService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(MAPS_PROVIDER) private readonly maps: MapsProvider,
  ) {}

  async create(clientId: string, body: ParsedQuoteRequest): Promise<QuoteView> {
    const now = new Date();
    const pickupAt = body.pickupAt ? new Date(body.pickupAt) : null;
    if (pickupAt && pickupAt.getTime() < now.getTime() - 60_000) {
      throw new BadRequestException('Choose a pickup time in the future');
    }
    if (pickupAt && pickupAt.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86_400_000) {
      throw new BadRequestException(`Trips can be booked up to ${MAX_DAYS_AHEAD} days ahead`);
    }

    const city = await this.cityFor(body.pickup);
    const rule = await this.ruleFor(city.id);

    let route: Route | null = null;
    if (body.destination) {
      try {
        route = await this.maps.route(body.pickup, body.destination);
      } catch {
        throw new ServiceUnavailableException('We could not reach the maps service. Try again.');
      }
      if (!route && body.tripType === 'drive_alone') {
        throw new UnprocessableEntityException(
          'We could not find a road route to that destination',
        );
      }
    }
    const distanceKm = route ? metersToPricedKm(route.distanceMeters) : null;
    const isNight = isNightPickup(pickupAt ?? now, city.timezone, rule);
    const fare =
      body.tripType === 'ride_with_me'
        ? quoteFare({ tripType: 'ride_with_me', hours: body.hours!, isNight }, rule)
        : quoteFare({ tripType: 'drive_alone', distanceKm: distanceKm!, isNight }, rule);

    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO quotes (client_id, city_id, pricing_rule_id, trip_type, pickup_label, pickup,
         destination_label, destination, planned_route, distance_km, duration_minutes, hours, task,
         scheduled_for, is_night, base_fare_kobo, night_kobo, total_fare_kobo, expires_at)
       VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
         $8, CASE WHEN $9::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($9, $10), 4326)::geography END,
         CASE WHEN $11::text IS NULL THEN NULL ELSE ST_GeogFromText($11) END,
         $12, $13, $14, $15, $16, $17, $18, $19, $20, now() + make_interval(mins => $21))
       RETURNING id`,
      [
        clientId,
        city.id,
        rule.id,
        body.tripType,
        body.pickup.label,
        body.pickup.lng,
        body.pickup.lat,
        body.destination?.label ?? null,
        body.destination?.lng ?? null,
        body.destination?.lat ?? null,
        route && route.path.length >= 2 ? lineString(route.path) : null,
        distanceKm,
        route ? Math.round(route.durationSeconds / 60) : null,
        body.tripType === 'ride_with_me' ? body.hours : null,
        body.tripType === 'drive_alone' ? body.task : null,
        pickupAt,
        isNight,
        fare.baseFareKobo,
        fare.nightKobo,
        fare.totalFareKobo,
        QUOTE_TTL_MINUTES,
      ],
    );
    return this.get(clientId, rows[0]!.id);
  }

  /** A client can only read their own quotes. */
  async get(clientId: string, id: string): Promise<QuoteView> {
    const { rows } = await this.pool.query<QuoteRow>(
      `SELECT ${QUOTE_COLUMNS} FROM quotes q JOIN pricing_rules r ON r.id = q.pricing_rule_id
       WHERE q.id = $1 AND q.client_id = $2`,
      [id, clientId],
    );
    const q = rows[0];
    if (!q) throw new NotFoundException('Quote not found');
    return {
      id: q.id,
      cityId: q.city_id,
      tripType: q.trip_type,
      pickup: { label: q.pickup_label, lat: q.pickup_lat, lng: q.pickup_lng },
      destination:
        q.destination_label && q.destination_lat != null && q.destination_lng != null
          ? { label: q.destination_label, lat: q.destination_lat, lng: q.destination_lng }
          : null,
      distanceKm: q.distance_km === null ? null : Number(q.distance_km),
      durationMinutes: q.duration_minutes,
      hours: q.hours,
      task: q.task,
      pickupAt: q.scheduled_for?.toISOString() ?? null,
      isNight: q.is_night,
      baseFareKobo: Number(q.base_fare_kobo),
      nightKobo: Number(q.night_kobo),
      totalFareKobo: Number(q.total_fare_kobo),
      hourlyRateKobo: Number(q.hourly_rate_kobo),
      expiresAt: q.expires_at.toISOString(),
    };
  }

  /** The live city whose service area covers the pickup. */
  private async cityFor(at: LatLng): Promise<{ id: string; timezone: string }> {
    const { rows } = await this.pool.query<{ id: string; timezone: string }>(
      `SELECT id, timezone FROM cities
       WHERE is_live AND service_area IS NOT NULL
         AND ST_Covers(service_area, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
       LIMIT 1`,
      [at.lng, at.lat],
    );
    if (!rows[0]) {
      throw new UnprocessableEntityException('Driva does not pick up from there yet');
    }
    return rows[0];
  }

  /** The city's own price rule if it has one, otherwise the shared default. */
  private async ruleFor(cityId: string): Promise<PricingRule & { id: string }> {
    const { rows } = await this.pool.query<RuleRow>(
      `SELECT * FROM pricing_rules
       WHERE (city_id = $1 OR city_id IS NULL) AND effective_from <= now()
       ORDER BY (city_id IS NULL), effective_from DESC
       LIMIT 1`,
      [cityId],
    );
    const r = rows[0];
    if (!r) throw new Error('No pricing rule configured');
    return {
      id: r.id,
      hourlyRateKobo: Number(r.hourly_rate_kobo),
      minHours: r.min_hours,
      soloBaseKobo: Number(r.solo_base_kobo),
      soloPerKmKobo: Number(r.solo_per_km_kobo),
      // Rounding to N100 is a CLAUDE.md rule, not a per city setting.
      soloRoundingKobo: 10_000,
      nightSurchargeKobo: Number(r.night_surcharge_kobo),
      nightStartMinute: r.night_start_minute,
      nightEndMinute: r.night_end_minute,
      commissionFirstYearBps: r.commission_first_year_bps,
      commissionAfterBps: r.commission_after_bps,
      firstYearMonths: 12,
    };
  }
}

function lineString(path: LatLng[]): string {
  return `LINESTRING(${path.map((p) => `${Number(p.lng)} ${Number(p.lat)}`).join(', ')})`;
}
