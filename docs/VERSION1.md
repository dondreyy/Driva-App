# Version 1 scope and build order

Goal: a pilot in Lekki, Victoria Island and Ikoyi with about 30 vetted drivers and a handful of business clients. Anything not listed is out of scope.

## In scope

1. Accounts: personal, business, driver sign up with OTP.
2. Driver registration and vetting workflow with admin tools for VeriQuest officers.
3. Booking both trip types with fixed pricing and night surcharge.
4. Matching with 30 second offers.
5. Trip flow: PIN, photos, live tracking, route alert, emergency button, end trip.
6. Payments through Paystack, driver ledger, daily payout.
7. Business accounts: team members, approval rule, monthly limit, monthly invoice.
8. Ratings and tips.
9. Push and SMS notifications.
10. Admin dashboard: vetting queue, live trips map, incidents, payouts, invoices.

## Out of scope for now

Scheduled premium trips, drivers who bring their own cars, in app chat history search, promo codes, referral rewards, web booking. Only Lagos is live, but the data model and screens are city aware so Abuja and others can be switched on later without a rewrite.

## Build order (each step ends with tests passing and a demo)

| Step | Deliverable | Done when |
|---|---|---|
| 0 | Monorepo, CI, linting, environments, database and migrations | `pnpm test` runs green in CI |
| 1 | Shared pricing package | Unit tests match every number in CLAUDE.md |
| 2 | Auth: OTP login, roles, refresh tokens | A user can sign up and log in on both apps |
| 3 | Driver registration and vetting data model, admin vetting queue | An officer can move a driver to approved |
| 4 | Client booking screens and quote API | A quote shows the correct price for any destination |
| 5 | Matching and driver request screen | A driver sees a 30 second request and can accept |
| 6 | Trip flow with PIN, photos, tracking, end trip | Full trip works on two real phones |
| 7 | Payments, ledger, payouts | Test card payment holds, captures and credits the driver |
| 8 | Safety: route alert, emergency, share trip, masked calls | Each alert reaches the admin dashboard |
| 9 | Business accounts and invoices | A business books for staff and receives one monthly invoice |
| 10 | Ratings, notifications, polish, store release | App Store and Play Store builds submitted |

## Acceptance checks that matter most

- A trip cannot start without the correct PIN.
- A driver who is not approved cannot go online or receive a request.
- The fare on a completed trip equals the fare quoted at acceptance.
- Commission uses 15% inside a driver's first 12 months and 20% after.
- Photos and documents are not reachable without a signed URL.
- Two people cannot accept the same request.
