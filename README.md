# OpenHorizon Forge

Monorepo for the DGX H200 training and serving platform.

## Workspace Layout

- `apps/control`: Hono API control plane (`@openhorizon/control`)
- `apps/web`: Web UI
- `apps/docs`: Internal docs
- `packages/db`: shared DB package (Drizzle schema/client/bootstrap) (`@openhorizon/db`)
- `packages/contracts`: shared API schemas and types (`@openhorizon/contracts`)
- `packages/ui`: shared React UI
- `packages/eslint-config`: shared lint config
- `packages/typescript-config`: shared TS config

## Quick Start

```sh
bun install
bun run dev
```

Run only control API:

```sh
bun run dev --filter=@openhorizon/control
```

Initialize DB schema for control API:

```sh
bun run db:up
bun run db:init
```

Drizzle workflow (from repo root):

```sh
bun run db:generate
bun run db:push
bun run db:studio
```

Environment variables:

- DB package: copy `packages/db/.env.example` to `packages/db/.env`
- Control API: copy `apps/control/.env.example` to `apps/control/.env`

## Control API Endpoints (V1 scaffold)

- `GET /healthz`
- `POST /v1/jobs`
- `GET /v1/jobs/:jobId`
