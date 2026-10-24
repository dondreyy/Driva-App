# One image definition for every part of Driva. Pick a part with --target:
#   api, admin, client-web, driver-web
# Used by docker-compose.yml for a local demo. The api and admin targets are also the starting
# point for production images.

FROM node:22-slim AS deps
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/client/package.json apps/client/
COPY apps/driver/package.json apps/driver/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

FROM deps AS source
COPY . .
RUN pnpm --filter @driva/shared build

# ---------- API ----------
FROM source AS api-build
RUN pnpm --filter @driva/api build

FROM node:22-slim AS api
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=api-build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 3000
# Applies any new migrations, then starts the API.
CMD ["sh", "-c", "node /repo/node_modules/node-pg-migrate/bin/node-pg-migrate.js up -m ../../database/migrations && node dist/main.js"]

# ---------- admin dashboard ----------
FROM source AS admin-build
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @driva/admin build

FROM node:22-slim AS admin
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
COPY --from=admin-build /repo/apps/admin/.next/standalone ./
COPY --from=admin-build /repo/apps/admin/.next/static ./apps/admin/.next/static
EXPOSE 3001
CMD ["node", "apps/admin/server.js"]

# ---------- browser builds of the mobile apps ----------
FROM source AS web-build
ARG APP
ARG EXPO_PUBLIC_API_URL
RUN pnpm --filter @driva/${APP} exec expo export --platform web --output-dir /web

FROM nginx:1.27-alpine AS web
COPY --from=web-build /web /usr/share/nginx/html
# Serves the app and passes /v1 to the API, so the app works from any address (a phone on the
# same Wi-Fi, for example) without knowing where the API is.
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  client_max_body_size 12m;\n  location /v1/ { proxy_pass http://api:3000; proxy_set_header Host $host; }\n  location / { try_files $uri /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf
