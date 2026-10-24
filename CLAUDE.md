# Driva: instructions for Claude Code

Read this file first in every session. It is the source of truth for what we are building and how.

## What Driva is

Driva is a customer facing mobile app in Lagos, Nigeria. It connects vetted professional drivers to private car owners and organizations. The driver drives the client's own car. Clients are billed per trip.

Every driver is physically verified by VeriQuest, a background check and verification company, before their first ride. VeriQuest and Driva have the same owner. Driva never accepts a driver that VeriQuest has not approved.

Two trip types:
- **Ride with me**: the client rides along. Priced per hour, 2 hours minimum.
- **Drive my car alone**: the driver moves the car for the client. Flat fare based on distance.

Three kinds of user: personal clients, business clients (organizations with staff and a monthly invoice), and drivers. Plus an internal admin team.

## Cities

We launch in Lagos only. Abuja and other major Nigerian cities follow. Build for many cities from day one: every driver, booking and pricing rule belongs to a city (`cities` table), a city is only open for bookings when `is_live` is true, and pickups must fall inside the city's service area. Never hard code Lagos place names, prices or coordinates in app code. Prices default to the shared rule and can be overridden per city.

## Business rules (do not change without asking)

- Currency is naira. Store every amount as an integer in kobo. Never use floats for money.
- Ride with me: N3,500 per hour, minimum 2 hours.
- Drive my car alone: N2,500 base plus N300 per km, rounded to the nearest N100.
- Night trips add N1,500. A trip is a night trip when its pickup time is from 9pm up to (not including) 5am, in the city's local time.
- No booking fee for clients.
- Driva commission: 15% of the fare for each driver's first 12 months from approval date, then 20%. The rate is per driver, not global. Store the rate on each trip at the time it is completed.
- The fare is locked when a driver accepts. It never changes afterwards.
- Payment is held when the trip is requested and released to the driver ledger when the trip ends.
- Business clients can pay by monthly invoice (only after their company check is approved) or by wallet per trip.
- Driver vetting is free for founding drivers. Otherwise the vetting fee is deducted from the driver's first trips.
- Vetting includes: NIN check, driving licence check, criminal record check, a physical home visit, and two guarantors who are each visited in person. Re-check every 12 months.
- A guarantor is a working adult who has known the driver for at least 2 years, lives in Lagos and agrees to a home visit.

## Safety features that must exist in version 1

- Trip PIN: the client gives a 4 digit PIN to the driver at pickup. The trip cannot start without it.
- Driver shift selfie before going online.
- Live location tracking during the trip, shareable by link.
- Route deviation alert to the client and to Driva support.
- Five photos of the car before the trip and five after (front, back, left, right, fuel and dash) for Drive my car alone.
- Emergency button for clients and drivers that alerts Driva support and the emergency contact.
- Calls and chat go through Driva so phone numbers stay private.

## Stack

- Mobile apps: React Native with Expo and TypeScript. One repo, two apps (client, driver) sharing a package.
- Backend: Node.js with NestJS and TypeScript, REST plus WebSocket for live tracking.
- Database: PostgreSQL 16 with PostGIS. Redis for queues, locks and live location.
- Admin dashboard: Next.js.
- Maps: Google Maps Platform.
- Payments: Paystack (Flutterwave as backup).
- SMS and OTP: Termii or Africa's Talking. Push: Firebase Cloud Messaging. WhatsApp Business for notifications.
- Identity checks: Smile ID, Dojah or Prembly behind one interface so the provider can change.
- Hosting: AWS. There is no AWS data centre in Nigeria, so the servers run in Cape Town (af-south-1) or Europe. This does not limit where Driva can operate. Confirm data storage rules under the Nigeria Data Protection Act with a lawyer before launch.
- Monorepo with pnpm workspaces.

## Repo layout to create

```
apps/
  client/        Expo app for clients
  driver/        Expo app for drivers
  admin/         Next.js admin dashboard
  api/           NestJS backend
packages/
  shared/        shared TypeScript types, pricing function, constants
  ui/            shared design tokens and components
database/
  schema.sql     starting schema (see this repo)
  migrations/    one migration per change, never edit applied ones
docs/
```

## Working rules

1. Work in small steps. After each step run the tests and the linter, then summarize what changed.
2. Write the pricing function once in `packages/shared` with unit tests that match the numbers above. Both apps and the API use it.
3. Every endpoint validates input and checks that the caller is allowed to touch that record.
4. Never log phone numbers, NINs, addresses or photos. Mask them.
5. Secrets live in environment variables. Never commit them.
6. Money, trip status changes and vetting decisions write to an append only audit table.
7. Design: navy #0B2545 and amber #F5A524, Bricolage Grotesque for headings, DM Sans for body. Match the clickable prototype in `docs/prototype/`.
8. Comply with the Nigeria Data Protection Act. Collect only what is needed, record consent, allow deletion requests.
9. If a requirement is unclear, make the most reasonable decision yourself, including on money, safety and vetting details, and choose the option that is easiest to change later: a constant, a config value, a `pricing_rules` column or a data row, never something that would need a rebuild. Record every such decision in `docs/DECISIONS.md` with where to change it, and list new ones in the summary at the end of each step. Ask first only before something that is hard to undo (deleting or rewriting data, publishing to app stores), needs a person's legal or compliance sign off, or spends money or needs a new outside account.

## Where to look

- `docs/ARCHITECTURE.md`: how the pieces fit.
- `docs/VERSION1.md`: scope, build order and acceptance checks.
- `docs/API.md`: endpoint outline.
- `database/schema.sql`: tables.
- `docs/DECISIONS.md`: decisions made where these documents were silent, and where to change each one.
- `docs/DEVELOPMENT.md`: running everything locally.
