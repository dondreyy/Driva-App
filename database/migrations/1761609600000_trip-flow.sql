-- Up Migration
-- The trip itself (Step 6).

-- The 4 digit PIN the client reads out at pickup. Encrypted, so the client app can show it
-- again; checked against what the driver types.
ALTER TABLE bookings ADD COLUMN trip_pin_encrypted bytea;
-- After too many wrong PINs, entry pauses until this time.
ALTER TABLE bookings ADD COLUMN pin_locked_until timestamptz;

CREATE INDEX trip_share_links_booking_idx ON trip_share_links (booking_id);

-- Down Migration
DROP INDEX trip_share_links_booking_idx;
ALTER TABLE bookings DROP COLUMN pin_locked_until;
ALTER TABLE bookings DROP COLUMN trip_pin_encrypted;
