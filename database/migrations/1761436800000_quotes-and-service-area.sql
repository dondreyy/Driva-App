-- Up Migration
-- Booking quotes (Step 4).

-- Night window per pricing rule, in minutes after local midnight. 9pm to 5am by default.
ALTER TABLE pricing_rules ADD COLUMN night_start_minute int NOT NULL DEFAULT 1260
  CHECK (night_start_minute BETWEEN 0 AND 1439);
ALTER TABLE pricing_rules ADD COLUMN night_end_minute int NOT NULL DEFAULT 300
  CHECK (night_end_minute BETWEEN 0 AND 1439);

-- A price shown to a client before they book. The booking copies these amounts, and they
-- lock when a driver accepts.
CREATE TABLE quotes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id           uuid NOT NULL REFERENCES cities(id),
  pricing_rule_id   uuid NOT NULL REFERENCES pricing_rules(id),
  trip_type         trip_type NOT NULL,
  pickup_label      text NOT NULL,
  pickup            geography(Point,4326) NOT NULL,
  destination_label text,
  destination       geography(Point,4326),
  planned_route     geography(LineString,4326),
  distance_km       numeric(6,1),
  duration_minutes  int,
  hours             int CHECK (hours IS NULL OR hours >= 2),
  task              text,
  scheduled_for     timestamptz,                -- null means now
  is_night          boolean NOT NULL,
  base_fare_kobo    bigint NOT NULL CHECK (base_fare_kobo >= 0),
  night_kobo        bigint NOT NULL CHECK (night_kobo >= 0),
  total_fare_kobo   bigint NOT NULL CHECK (total_fare_kobo = base_fare_kobo + night_kobo),
  expires_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (trip_type <> 'ride_with_me' OR hours IS NOT NULL),
  CHECK (trip_type <> 'drive_alone' OR (destination IS NOT NULL AND distance_km IS NOT NULL))
);
CREATE INDEX quotes_client_idx ON quotes (client_id, created_at DESC);

ALTER TABLE bookings ADD COLUMN quote_id uuid REFERENCES quotes(id);

-- Version 1 pilot area: Ikoyi, Victoria Island and the Lekki corridor to Ajah. Pickups must be
-- inside it; destinations can be anywhere. Redraw it with a new migration when the area grows.
UPDATE cities SET
  centre = ST_GeogFromText('POINT(3.4723 6.4478)'),
  service_area = ST_GeogFromText(
    'POLYGON((3.395 6.415, 3.600 6.415, 3.600 6.485, 3.470 6.475, 3.430 6.470, 3.410 6.462, 3.395 6.445, 3.395 6.415))'
  )
WHERE name = 'Lagos' AND service_area IS NULL;
CREATE INDEX cities_service_area_gix ON cities USING gist (service_area);

-- Down Migration
DROP INDEX cities_service_area_gix;
UPDATE cities SET service_area = NULL, centre = NULL WHERE name = 'Lagos';
ALTER TABLE bookings DROP COLUMN quote_id;
DROP TABLE quotes;
ALTER TABLE pricing_rules DROP COLUMN night_end_minute;
ALTER TABLE pricing_rules DROP COLUMN night_start_minute;
