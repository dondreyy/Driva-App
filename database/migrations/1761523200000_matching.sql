-- Up Migration
-- Matching (Step 5).

-- Where each online driver is. Kept in Postgres for the pilot (about 30 drivers); it can move to
-- Redis when there are many more drivers.
CREATE TABLE driver_presence (
  driver_id  uuid PRIMARY KEY REFERENCES drivers(user_id) ON DELETE CASCADE,
  shift_id   uuid NOT NULL REFERENCES driver_shifts(id) ON DELETE CASCADE,
  location   geography(Point,4326) NOT NULL,
  heading    smallint,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_presence_gix ON driver_presence USING gist (location);

-- A driver has at most one open shift, and at most one request in front of them.
CREATE UNIQUE INDEX one_open_shift_per_driver ON driver_shifts (driver_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX one_open_offer_per_driver ON booking_offers (driver_id) WHERE status = 'offered';
CREATE INDEX booking_offers_open_idx ON booking_offers (expires_at) WHERE status = 'offered';

-- A quote can be booked once.
CREATE UNIQUE INDEX one_booking_per_quote ON bookings (quote_id) WHERE quote_id IS NOT NULL;
-- When matching gives up and the booking becomes no_driver.
ALTER TABLE bookings ADD COLUMN matching_deadline timestamptz;
CREATE INDEX bookings_open_idx ON bookings (created_at) WHERE status IN ('requested', 'matching');

-- Down Migration
DROP INDEX bookings_open_idx;
ALTER TABLE bookings DROP COLUMN matching_deadline;
DROP INDEX one_booking_per_quote;
DROP INDEX booking_offers_open_idx;
DROP INDEX one_open_offer_per_driver;
DROP INDEX one_open_shift_per_driver;
DROP TABLE driver_presence;
