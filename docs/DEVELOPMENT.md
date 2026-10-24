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
pnpm dev:admin                # http://localhost:3001
```

### Staff accounts

Staff cannot sign up. Create admins and VeriQuest officers from the command line:

```sh
DATABASE_URL=... pnpm --filter @driva/api staff:create --phone 0803 555 0100 --name "Ada Obi" --role vetting_officer
```

Roles are `admin` and `vetting_officer`. Both can work the vetting queue and approve drivers;
only admins can mark a founding driver's vetting as free.

### Files

Driver documents and visit evidence are private. In development they are stored under
`STORAGE_LOCAL_DIR` and served by the API through signed, expiring links. In production they go
to S3 (`STORAGE_PROVIDER=s3`). The S3 bucket must block public access and allow `PUT` from the
apps and the admin dashboard's origin in its CORS settings.

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
