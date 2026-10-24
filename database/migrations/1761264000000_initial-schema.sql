-- Up Migration
-- Initial schema, copied from database/schema.sql (the starter pack schema).
-- Never edit this file once applied. Add a new migration for every change.

-- Driva starting schema. PostgreSQL 16 with PostGIS.
-- All money is stored as integer kobo. All times are timestamptz in UTC.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------- enums ----------
CREATE TYPE user_role AS ENUM ('client','driver','admin','vetting_officer');
CREATE TYPE org_status AS ENUM ('pending_check','approved','suspended');
CREATE TYPE org_member_role AS ENUM ('owner','admin','member');
CREATE TYPE billing_mode AS ENUM ('invoice','wallet');
CREATE TYPE driver_status AS ENUM ('applied','in_vetting','approved','rejected','suspended');
CREATE TYPE vetting_step AS ENUM ('documents','home_visit','guarantor_visit_1','guarantor_visit_2','criminal_record','final_review');
CREATE TYPE check_status AS ENUM ('pending','in_progress','passed','failed');
CREATE TYPE trip_type AS ENUM ('ride_with_me','drive_alone');
CREATE TYPE booking_status AS ENUM ('requested','matching','accepted','driver_arrived','in_progress','completed','cancelled','no_driver');
CREATE TYPE offer_status AS ENUM ('offered','accepted','declined','expired');
CREATE TYPE photo_phase AS ENUM ('before','after');
CREATE TYPE payment_status AS ENUM ('initiated','held','captured','refunded','failed');
CREATE TYPE ledger_kind AS ENUM ('trip_earning','commission','tip','vetting_fee','payout','adjustment');
CREATE TYPE payout_status AS ENUM ('pending','processing','paid','failed');
CREATE TYPE invoice_status AS ENUM ('draft','sent','paid','overdue');
CREATE TYPE incident_kind AS ENUM ('emergency','route_deviation','complaint','damage','other');
CREATE TYPE incident_status AS ENUM ('open','acknowledged','resolved');

-- ---------- cities ----------
-- Launch in Lagos only, but every price, driver and trip belongs to a city so Abuja,
-- Port Harcourt and others can be added by inserting a row, not rewriting the app.
CREATE TABLE cities (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name      text NOT NULL UNIQUE,
  state     text,
  timezone  text NOT NULL DEFAULT 'Africa/Lagos',
  centre    geography(Point,4326),
  service_area geography(Polygon,4326),     -- where pickups are allowed
  is_live   boolean NOT NULL DEFAULT false, -- bookings open only when true
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- people ----------
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role           user_role NOT NULL,
  phone          text NOT NULL UNIQUE,
  email          citext UNIQUE,
  full_name      text NOT NULL,
  phone_verified_at timestamptz,
  emergency_contact_name  text,
  emergency_contact_phone text,
  consent_recorded_at timestamptz,
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  code_hash   text NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_phone_idx ON otp_codes (phone, created_at DESC);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  device      text,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- organizations (business clients) ----------
CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  rc_number     text NOT NULL UNIQUE,
  industry      text,
  contact_email citext NOT NULL,
  status        org_status NOT NULL DEFAULT 'pending_check',
  billing       billing_mode NOT NULL DEFAULT 'invoice',
  trips_need_approval boolean NOT NULL DEFAULT false,
  monthly_limit_per_member_kobo bigint,           -- null means no limit
  cac_document_key text,
  owner_id_document_key text,
  checked_by    uuid REFERENCES users(id),
  checked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            org_member_role NOT NULL DEFAULT 'member',
  added_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

-- ---------- vehicles (client cars) ----------
CREATE TABLE vehicles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  make_model   text NOT NULL,
  plate_number text NOT NULL,
  colour       text,
  transmission text CHECK (transmission IN ('automatic','manual')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL) <> (organization_id IS NOT NULL))
);

-- ---------- drivers and vetting ----------
CREATE TABLE drivers (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  city_id        uuid REFERENCES cities(id),
  status         driver_status NOT NULL DEFAULT 'applied',
  nin_encrypted  bytea,                       -- encrypt in the app, never store plain
  licence_number_encrypted bytea,
  years_driving  text,
  home_address   text,
  home_location  geography(Point,4326),
  selfie_key     text,
  rating_avg     numeric(3,2),
  rating_count   int NOT NULL DEFAULT 0,
  approved_at    timestamptz,                 -- starts the 12 month 15% commission window
  last_full_vetting_at timestamptz,           -- must be under 12 months old to go online
  vetting_fee_waived boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE driver_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('licence','nin','passport_photo','selfie')),
  storage_key text NOT NULL,
  verified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guarantors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    uuid NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
  slot         smallint NOT NULL CHECK (slot IN (1,2)),
  full_name    text NOT NULL,
  phone        text NOT NULL,
  relationship text NOT NULL,
  address      text NOT NULL,
  location     geography(Point,4326),
  UNIQUE (driver_id, slot)
);

CREATE TABLE vetting_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    uuid NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
  step         vetting_step NOT NULL,
  status       check_status NOT NULL DEFAULT 'pending',
  officer_id   uuid REFERENCES users(id),     -- VeriQuest officer for field visits
  scheduled_for timestamptz,
  completed_at timestamptz,
  result_note  text,
  evidence_keys text[] NOT NULL DEFAULT '{}', -- GPS stamped photos and reports
  visit_location geography(Point,4326),
  round        int NOT NULL DEFAULT 1,        -- increments on the 12 month re-check
  UNIQUE (driver_id, step, round)
);

CREATE TABLE driver_consents (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id  uuid NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('home_visit','guarantor_visits','id_and_criminal_checks')),
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE driver_shifts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
  selfie_key  text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);

-- ---------- pricing ----------
CREATE TABLE pricing_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id         uuid REFERENCES cities(id),   -- null means the default for any city without its own rule
  hourly_rate_kobo      bigint NOT NULL DEFAULT 350000,
  min_hours             int    NOT NULL DEFAULT 2,
  solo_base_kobo        bigint NOT NULL DEFAULT 250000,
  solo_per_km_kobo      bigint NOT NULL DEFAULT 30000,
  night_surcharge_kobo  bigint NOT NULL DEFAULT 150000,
  commission_first_year_bps int NOT NULL DEFAULT 1500,   -- 15.00%
  commission_after_bps      int NOT NULL DEFAULT 2000,   -- 20.00%
  effective_from  timestamptz NOT NULL DEFAULT now()
);

-- ---------- bookings and trips ----------
CREATE TABLE bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id         uuid NOT NULL REFERENCES cities(id),
  trip_type       trip_type NOT NULL,
  status          booking_status NOT NULL DEFAULT 'requested',
  client_id       uuid NOT NULL REFERENCES users(id),             -- who is booking
  booked_for_id   uuid REFERENCES users(id),                      -- staff member, for business bookings
  organization_id uuid REFERENCES organizations(id),
  driver_id       uuid REFERENCES drivers(user_id),
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  pickup_label    text NOT NULL,
  pickup          geography(Point,4326) NOT NULL,
  destination_label text,
  destination     geography(Point,4326),
  planned_route   geography(LineString,4326),
  distance_km     numeric(6,1),
  hours           int CHECK (hours IS NULL OR hours >= 2),
  task            text,                                           -- for drive_alone
  scheduled_for   timestamptz,                                    -- null means now
  is_night        boolean NOT NULL DEFAULT false,
  needs_approval  boolean NOT NULL DEFAULT false,
  approved_by     uuid REFERENCES users(id),
  -- price is locked when a driver accepts
  base_fare_kobo      bigint NOT NULL,
  night_kobo          bigint NOT NULL DEFAULT 0,
  total_fare_kobo     bigint NOT NULL,
  fare_locked_at      timestamptz,
  -- filled when the trip completes
  commission_bps      int,
  commission_kobo     bigint,
  driver_earning_kobo bigint,
  tip_kobo            bigint NOT NULL DEFAULT 0,
  trip_pin_hash       text,
  pin_attempts        int NOT NULL DEFAULT 0,
  pin_verified_at     timestamptz,
  accepted_at     timestamptz,
  arrived_at      timestamptz,
  started_at      timestamptz,
  ended_at        timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (trip_type <> 'ride_with_me' OR hours IS NOT NULL),
  CHECK (trip_type <> 'drive_alone' OR destination IS NOT NULL)
);
CREATE INDEX bookings_client_idx ON bookings (client_id, created_at DESC);
CREATE INDEX bookings_org_idx ON bookings (organization_id, created_at DESC);
CREATE INDEX bookings_driver_idx ON bookings (driver_id, created_at DESC);
CREATE INDEX bookings_status_idx ON bookings (status);
CREATE INDEX bookings_pickup_gix ON bookings USING gist (pickup);
-- A driver can have only one active trip at a time.
CREATE UNIQUE INDEX one_active_trip_per_driver ON bookings (driver_id)
  WHERE status IN ('accepted','driver_arrived','in_progress');

CREATE TABLE booking_offers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  driver_id   uuid NOT NULL REFERENCES drivers(user_id),
  status      offer_status NOT NULL DEFAULT 'offered',
  offered_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  responded_at timestamptz,
  UNIQUE (booking_id, driver_id)
);
-- Only one offer per booking can ever be accepted.
CREATE UNIQUE INDEX one_accepted_offer_per_booking ON booking_offers (booking_id) WHERE status = 'accepted';

CREATE TABLE trip_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  phase       photo_phase NOT NULL,
  shot        text NOT NULL CHECK (shot IN ('front','back','left','right','fuel_dash')),
  storage_key text NOT NULL,
  taken_at    timestamptz NOT NULL DEFAULT now(),
  location    geography(Point,4326),
  UNIQUE (booking_id, phase, shot)
);

CREATE TABLE trip_locations (
  id          bigserial PRIMARY KEY,
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  location    geography(Point,4326) NOT NULL,
  heading     smallint,
  speed_kmh   numeric(5,1),
  off_route   boolean NOT NULL DEFAULT false,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_locations_idx ON trip_locations (booking_id, recorded_at);

CREATE TABLE trip_share_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE incidents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid REFERENCES bookings(id),
  raised_by   uuid REFERENCES users(id),
  kind        incident_kind NOT NULL,
  status      incident_status NOT NULL DEFAULT 'open',
  location    geography(Point,4326),
  description text,
  handled_by  uuid REFERENCES users(id),
  resolution_note text,                         -- required before status can become resolved
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (status <> 'resolved' OR resolution_note IS NOT NULL)
);

CREATE TABLE ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  rater_id    uuid NOT NULL REFERENCES users(id),
  ratee_id    uuid NOT NULL REFERENCES users(id),
  stars       smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags        text[] NOT NULL DEFAULT '{}',
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, rater_id)
);

-- ---------- money ----------
CREATE TABLE payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid REFERENCES bookings(id),
  invoice_id    uuid,                            -- set for monthly invoice payments
  user_id       uuid NOT NULL REFERENCES users(id),
  provider      text NOT NULL DEFAULT 'paystack',
  provider_ref  text UNIQUE,
  amount_kobo   bigint NOT NULL CHECK (amount_kobo > 0),
  status        payment_status NOT NULL DEFAULT 'initiated',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Every movement of money for a driver. Positive credits the driver, negative debits.
CREATE TABLE driver_ledger (
  id          bigserial PRIMARY KEY,
  driver_id   uuid NOT NULL REFERENCES drivers(user_id),
  booking_id  uuid REFERENCES bookings(id),
  kind        ledger_kind NOT NULL,
  amount_kobo bigint NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_ledger_idx ON driver_ledger (driver_id, created_at DESC);

CREATE TABLE payouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid NOT NULL REFERENCES drivers(user_id),
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  status      payout_status NOT NULL DEFAULT 'pending',
  bank_code   text,
  account_number_encrypted bytea,
  provider_ref text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  paid_at     timestamptz
);

CREATE TABLE invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  total_kobo      bigint NOT NULL,
  status          invoice_status NOT NULL DEFAULT 'draft',
  due_date        date,
  sent_at         timestamptz,
  paid_at         timestamptz,
  UNIQUE (organization_id, period_start)
);
ALTER TABLE payments ADD CONSTRAINT payments_invoice_fk FOREIGN KEY (invoice_id) REFERENCES invoices(id);
ALTER TABLE bookings ADD COLUMN invoice_id uuid REFERENCES invoices(id);

-- ---------- notifications and audit ----------
CREATE TABLE device_tokens (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token     text NOT NULL UNIQUE,
  platform  text NOT NULL CHECK (platform IN ('ios','android')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append only. Never update or delete rows here.
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text NOT NULL,
  details     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_log (entity, entity_id);

CREATE OR REPLACE FUNCTION audit_log_block_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_changes();

-- Seed Lagos (live) and the default pricing rule. Add Abuja later with is_live = false until ready.
INSERT INTO cities (name, state, is_live) VALUES ('Lagos','Lagos',true);
INSERT INTO pricing_rules DEFAULT VALUES;

-- Down Migration
DROP TABLE IF EXISTS audit_log, device_tokens, invoices, payouts, driver_ledger, payments, ratings, incidents, trip_share_links, trip_locations, trip_photos, booking_offers, bookings, pricing_rules, driver_shifts, driver_consents, vetting_checks, guarantors, driver_documents, drivers, vehicles, organization_members, organizations, refresh_tokens, otp_codes, users, cities CASCADE;
DROP FUNCTION IF EXISTS audit_log_block_changes();
DROP TYPE IF EXISTS user_role, org_status, org_member_role, billing_mode, driver_status, vetting_step, check_status, trip_type, booking_status, offer_status, photo_phase, payment_status, ledger_kind, payout_status, invoice_status, incident_kind, incident_status;
