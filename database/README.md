# Database

PostgreSQL 16 with PostGIS. Migrations in `migrations/` are the source of truth and are run
with [node-pg-migrate](https://salsita.github.io/node-pg-migrate/):

```sh
pnpm db:migrate     # apply pending migrations (needs DATABASE_URL)
pnpm db:rollback    # undo the last migration
pnpm --filter @driva/api db:new -- add-something   # new SQL migration file
```

Rules:

- One migration per change. Never edit a migration that has been applied anywhere.
- Each file has a `-- Up Migration` section and a `-- Down Migration` section.

`schema.sql` is the original starter schema. It is kept for reference only and became
`migrations/1761264000000_initial-schema.sql`. Do not change it; change the database with a
new migration.
