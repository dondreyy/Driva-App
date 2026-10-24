# Running Driva locally

Needs Node 22, pnpm 10 and Postgres 16 with PostGIS.

```sh
pnpm install
cp .env.example .env          # then fill in JWT_SECRET and OTP_PEPPER (openssl rand -base64 48)

# Postgres with PostGIS in Docker, matching DATABASE_URL in .env.example
docker run -d --name driva-db -p 5432:5432 \
  -e POSTGRES_USER=driva -e POSTGRES_PASSWORD=driva -e POSTGRES_DB=driva postgis/postgis:16-3.4

DATABASE_URL=postgres://driva:driva@localhost:5432/driva pnpm db:migrate
pnpm dev:api                  # http://localhost:3000/v1/health
pnpm dev:client               # Expo: press i, a or w
pnpm dev:driver
```

With `SMS_PROVIDER=console` the API prints login codes to its log instead of texting them,
for example `SMS to +*********0142: Your Driva code is 123456`. Production refuses this setting.

The apps call `EXPO_PUBLIC_API_URL` (default `http://localhost:3000`). On a real phone or the
Android emulator, set it to your computer's address, for example
`EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 pnpm dev:client`. Web builds also need
`CORS_ORIGINS` set on the API.

## Checks

```sh
pnpm lint && pnpm format:check && pnpm typecheck
DATABASE_URL=postgres://driva:driva@localhost:5432/driva_test pnpm test
```

API tests that need the database are skipped when `DATABASE_URL` is not set. CI always runs them.
