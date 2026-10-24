# Decisions log

Where the business documents were silent, these choices were made. Each is built to be easy to
change. To change one, edit the place named; prices and rules in the database change with a new
migration or a new `pricing_rules` row, never by editing an old migration.

## Money and pricing

| Decision | Where to change |
|---|---|
| Drive my car alone: the fare is rounded to the nearest N100, halves round up (N7,450 becomes N7,500). | `roundToNearest` in `packages/shared/src/money.ts` |
| Distance is the road distance of Google's main driving route, traffic ignored, rounded to 0.1 km, so the same trip costs the same at any hour. | `GoogleMapsProvider.route` and `metersToPricedKm` in `apps/api` |
| Night trips: pickup from 9pm up to 5am in the city's local time adds N1,500. Decided by the pickup time only. | `pricing_rules.night_start_minute` / `night_end_minute` (per city), `isNightPickup` |
| Commission is taken on the whole fare including the night fee, not on tips. | `splitFare` in `packages/shared/src/pricing.ts` |
| The 15% commission year is 12 calendar months from the moment of first approval (approved 29 Feb: ends 28 Feb). Commission is rounded to the nearest kobo. | `commissionBpsFor`, `firstYearMonths`; `drivers.approved_at` is set only once |
| Ride with me is booked in whole hours, 2 to 12. Fewer than 2 is refused rather than charged as 2. | `MAX_RIDE_HOURS` in `packages/shared/src/booking.ts`, `pricing_rules.min_hours` |
| A quote's price is held for 15 minutes. | `QUOTE_TTL_MINUTES` |
| Trips can be booked up to 7 days ahead, in 30 minute steps. | `MAX_DAYS_AHEAD`, `apps/client/src/when.ts` |
| Destination is optional for Ride with me and required for Drive my car alone, with one of four tasks (from the prototype). | `quoteRequestSchema`, `DRIVE_ALONE_TASKS` |
| A city can have its own price rule; otherwise the shared default applies. The newest rule with `effective_from` in the past wins. | `pricing_rules` rows |

## Cities and maps

| Decision | Where to change |
|---|---|
| Version 1 pickups must be inside a rough outline of Ikoyi, Victoria Island and the Lekki corridor to Ajah. Destinations can be anywhere. | `cities.service_area` (new migration to redraw) |
| Place search, place details and "where am I" go through the API so the Google key never reaches the phones. | `apps/api/src/maps` |
| Development uses sample places and straight line distance times 1.3. Production refuses it. | `MAPS_PROVIDER` |

## Sign in and accounts

| Decision | Where to change |
|---|---|
| Login codes are 6 digits (the prototype showed 4), valid 5 minutes, 5 wrong tries, 60 seconds between codes, 5 an hour per number. | `OTP_LENGTH` in `packages/shared/src/auth.ts`; constants in `apps/api/src/auth/otp.service.ts` |
| Access tokens last 15 minutes. App sessions last 30 days, staff dashboard sessions 12 hours. | `tokens.service.ts`, `apps/admin/src/lib/server-session.ts` |
| One phone number is one account with one role. A client's number cannot sign in to the driver app and the reverse. | `APP_ROLES` in `apps/api/src/auth/auth.service.ts` |
| Staff accounts are created only with the `staff:create` command, never by sign up. | `apps/api/src/cli/create-staff.ts` |
| SMS goes through Termii; Africa's Talking can be added behind the same interface. | `apps/api/src/auth/sms` |

## Driver vetting

| Decision | Where to change |
|---|---|
| Any VeriQuest officer or admin can approve, including the officer who did the visits. | `@Roles` on `VettingController`; add a second approver rule in `VettingService.recordResult` |
| A failed check rejects the driver straight away, with a reason. There is no "redo" yet. | `VettingService.recordResult` |
| A home or guarantor visit passes only with at least one photo and the officer's GPS location. The location is not yet compared with the address. | `FIELD_VISIT_STEPS`, `recordResult` |
| Founding drivers: an admin ticks "vetting is free" at approval. Officers cannot. | `approveDriverSchema.vettingFeeWaived` |
| The driver confirms both guarantors meet the rules (working adult, known 2 years, lives in the city, agrees to a visit); the officer checks in person. | `driverGuarantorsSchema.confirmRules` |
| Rejected drivers see a general message. Officers' notes are for staff only, and the audit log records that a note exists, not what it says. | `VettingStatus.tsx`, `recordResult` |
| Driver document photos are taken with the camera, not chosen from the gallery. | `apps/driver/src/photos.ts` |
| One NIN can register only one driver. | `drivers.nin_lookup_hash` |
| Staff see NIN and licence masked; showing one in full is recorded in the audit log. | `VettingService.reveal` |

## Hosting

| Decision | Where to change |
|---|---|
| Photos and documents: private S3 in production, signed links that expire after 5 minutes (10 for uploads). | `apps/api/src/storage` |
| The Docker images are a demo and the starting point for production. The API image carries the whole workspace (about 1.5 GB) and should be slimmed before production. | `Dockerfile` |
