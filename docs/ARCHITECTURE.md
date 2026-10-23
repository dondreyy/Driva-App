# Architecture

## Pieces

| Piece | What it does |
|---|---|
| Client app | Sign up, book, pay, track, rate. Personal and business accounts. |
| Driver app | Registration, go online, receive requests, trip steps, earnings. |
| API | All business rules, pricing, matching, payments, vetting records. One NestJS service split into modules. |
| Admin dashboard | Vetting queue, driver approval, live trips, incidents, payouts, invoices. |
| Postgres + PostGIS | Source of truth. |
| Redis | Driver presence, live location, request timers, job queues. |
| Object storage (S3) | Photos and documents, private buckets, signed URLs only. |

## API modules

auth, users, organizations, drivers, vetting, vehicles, pricing, bookings, matching, trips, tracking, payments, payouts, invoices, ratings, incidents, notifications, admin, audit.

## Booking lifecycle

```
requested -> matching -> accepted -> driver_arrived -> in_progress -> completed
                 |           |             |
                 v           v             v
             no_driver   cancelled     cancelled
```

1. Client requests. API computes the price with the shared pricing function and stores a quote.
2. Payment is authorized and held.
3. Matching offers the request to the nearest eligible drivers one at a time. Each offer lasts 30 seconds. Eligible means approved, online, no active trip, within 8 km of pickup.
4. A driver accepts. The fare locks. The client sees the driver card with the VeriQuest badge.
5. Driver arrives and the client reads out the PIN. Driver enters it. For Drive my car alone the driver also uploads five photos first.
6. Trip runs. Driver app sends location every 5 seconds. A background check compares the position to the planned route and raises a deviation alert after 3 consecutive points more than 400 metres off.
7. Driver ends the trip. For Drive my car alone, five return photos are required.
8. Commission is calculated using the driver's current rate. The driver ledger is credited. The payment is captured.
9. Both sides rate each other.

## Vetting lifecycle

```
applied -> documents_checked -> home_visit -> guarantor_visits -> criminal_check -> approved
                                                                          \-> rejected (at any step, with reason)
```

Each step is a row in `vetting_checks`. Field visits are assigned to a VeriQuest officer and need GPS stamped photos as evidence. A driver can go online only when `drivers.status = 'approved'` and the last full vetting is under 12 months old.

## Cities

Every driver, booking and pricing rule has a city. Matching only considers drivers in the booking's city. A city accepts bookings only when `cities.is_live` is true. Adding a city means inserting a row, drawing its service area, optionally setting its own prices, and approving drivers there.

## Security

- Phone number login with OTP. Short lived access tokens and refresh tokens.
- Role based access: client, business_admin, business_member, driver, admin, vetting_officer.
- Private storage and signed URLs for photos and documents.
- Rate limits on OTP, booking and location endpoints.
- Encrypt NIN and licence numbers at rest. Mask in logs.
- Emergency events page the support team immediately and cannot be dismissed without a note.

## Build order at a glance

See `VERSION1.md`.
