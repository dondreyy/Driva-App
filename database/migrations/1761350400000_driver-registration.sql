-- Up Migration
-- Driver registration (Step 3).
-- nin_lookup_hash: HMAC of the NIN so one NIN cannot register twice. The NIN itself stays
-- encrypted in nin_encrypted and cannot be searched.
ALTER TABLE drivers ADD COLUMN nin_lookup_hash text UNIQUE;
-- When the driver sent the finished application to VeriQuest. Orders the vetting queue.
ALTER TABLE drivers ADD COLUMN submitted_at timestamptz;
CREATE INDEX drivers_status_idx ON drivers (status, submitted_at);
CREATE INDEX vetting_checks_status_idx ON vetting_checks (status, step);
-- One record per consent kind; giving it again keeps the first time it was given.
ALTER TABLE driver_consents ADD CONSTRAINT driver_consents_once UNIQUE (driver_id, kind);

-- Down Migration
ALTER TABLE driver_consents DROP CONSTRAINT driver_consents_once;
DROP INDEX vetting_checks_status_idx;
DROP INDEX drivers_status_idx;
ALTER TABLE drivers DROP COLUMN submitted_at;
ALTER TABLE drivers DROP COLUMN nin_lookup_hash;
