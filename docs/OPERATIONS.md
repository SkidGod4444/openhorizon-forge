# Operations Runbook

## Database Migration Policy

1. Always run migrations in forward-only mode.
2. Never edit an already-applied migration file.
3. Generate new migration for every schema change:
   - `bun run db:generate`
   - review SQL
   - `bun run db:migrate`
4. Apply migrations first in non-prod environment, validate API/CLI smoke tests, then prod.
5. Keep one release tag mapped to one DB migration state.

## Backup & Restore

### Backup (Postgres)

```bash
pg_dump "$DATABASE_URL" -Fc -f openhorizon_$(date +%F_%H%M%S).dump
```

### Restore (Postgres)

```bash
pg_restore -d "$DATABASE_URL" --clean --if-exists openhorizon_YYYY-MM-DD_HHMMSS.dump
```

### Restore validation checklist

1. `bun run db:init` (idempotent schema check)
2. `curl /healthz`
3. `ohctl job list`
4. `ohctl version`

## Release Rollout

1. Merge to main, ensure CI green.
2. Tag release: `ohctl-vX.Y.Z`
3. Verify GitHub Release assets (linux/darwin/windows).
4. Validate `ohctl version` from downloaded binary.
