# API outline

All routes are under `/v1`. JSON in and out. Amounts in kobo.

## Auth
- `POST /auth/otp/request` phone
- `POST /auth/otp/verify` phone, code, returns tokens
- `POST /auth/refresh`

## Clients and organizations
- `GET/PATCH /me`
- `POST /organizations` register a business
- `POST /organizations/:id/members`, `PATCH .../members/:memberId`
- `GET /organizations/:id/trips`, `GET /organizations/:id/invoices`

## Drivers and vetting
- `POST /drivers/register` step by step: profile, documents, address, guarantors, consent
- `GET /drivers/me/vetting` status of each check
- `POST /drivers/me/shift/start` selfie, goes online
- `POST /drivers/me/location` lat, lng, heading
- Admin: `GET /admin/vetting/queue`, `POST /admin/vetting/:checkId/result`, `POST /admin/drivers/:id/approve`

## Booking
- `POST /quotes` trip type, pickup, destination, hours, when
- `POST /bookings` quote id, vehicle id, payer (self or organization), booked for
- `POST /bookings/:id/cancel`
- `GET /bookings/:id`
- Driver: `POST /offers/:id/accept`, `POST /offers/:id/decline`

## Trip
- `POST /trips/:id/arrived`
- `POST /trips/:id/pin` driver submits PIN
- `POST /trips/:id/photos` phase (before or after), shot, file
- `POST /trips/:id/start`, `POST /trips/:id/end`
- `POST /trips/:id/share` creates a tracking link
- `POST /trips/:id/emergency`
- WebSocket `trips/:id` live position, status, alerts

## Money
- `POST /payments/initialize` Paystack
- `POST /webhooks/paystack`
- Driver: `GET /drivers/me/earnings`, `GET /drivers/me/payouts`
- Admin: `POST /admin/payouts/run`

## After the trip
- `POST /trips/:id/rating`, `POST /trips/:id/tip`
- `POST /trips/:id/report` problem report
