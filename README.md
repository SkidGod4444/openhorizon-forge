# OpenHorizon Forge

Monorepo for the DGX H200 training and serving platform.

## Workspace Layout

- `apps/control`: Hono API control plane (`@openhorizon/control`)
- `apps/web`: Web UI
- `apps/docs`: Internal docs
- `packages/db`: shared DB package (Drizzle schema/client/bootstrap) (`@openhorizon/db`)
- `packages/contracts`: shared API schemas and types (`@openhorizon/contracts`)
- `packages/ohforge`: publishable Go CLI (`ohctl`)
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

Run CLI:

```sh
go run ./packages/ohforge/cmd/ohctl job list
```

Short style (alias-oriented):

```sh
ohctl job status <job-id>
```

Initialize DB schema for control API:

```sh
bun run db:up
bun run db:init
```

Drizzle workflow (from repo root):

```sh
bun run db:generate
bun run db:migrate
```

Optional direct sync (may fail on some hosted Postgres introspection edge cases):

```sh
bun run db:push
bun run db:studio
```

Environment variables:

| Variable | Used By | Purpose | Default |
|---|---|---|---|
| `DATABASE_URL` | `packages/db`, `apps/control` | Postgres connection string for schema/migrations/runtime DB access. | `postgres://postgres:postgres@localhost:5432/openhorizon` |
| `DATABASE_MAX_CONNECTIONS` | `packages/db` | Max DB pool size for Postgres client. | `10` |
| `PORT` | `apps/control` | HTTP port for control API server. | `8080` |
| `CONTROL_API_KEY` | `apps/control` | If set, all endpoints except `/healthz` require bearer auth. | empty (auth disabled) |
| `SLURM_MOCK_MODE` | `apps/control` | Scheduler/log adapter mock mode toggle (`false` = real SLURM). | enabled unless explicitly `false` |
| `SCHEDULER_BACKEND` | `apps/control` | Runtime backend for job execution: `slurm` or `k8s`. | `slurm` |
| `SLURM_SCRIPTS_DIR` | `apps/control` | Directory where generated sbatch wrapper scripts are written. | `/tmp/openhorizon/slurm` |
| `SLURM_LOGS_DIR` | `apps/control` | Directory where SLURM job stdout/stderr logs are written. | `/tmp/openhorizon/logs` |
| `K8S_NAMESPACE` | `apps/control` | Kubernetes namespace for training Jobs (k8s backend only). | `default` |
| `K8S_TRAIN_IMAGE` | `apps/control` | Container image used for training Job execution (k8s backend only). | `python:3.11` |
| `OHCTL_API_BASE_URL` | `packages/ohforge` | Base URL for CLI API requests. | `http://localhost:8080` |
| `OHCTL_API_KEY` | `packages/ohforge` | Bearer token used by CLI for protected control API. | empty |
| `OHFORGE_API_BASE_URL` | `packages/ohforge` | Legacy alias for CLI base URL (backward compatibility). | none |

Setup:
- DB package env: copy `packages/db/.env.example` to `packages/db/.env`
- Control API env: copy `apps/control/.env.example` to `apps/control/.env`

## Control API Endpoints (V1 scaffold)

- `GET /healthz`
- `POST /v1/jobs`
- `GET /v1/jobs/:jobId`
- `GET /v1/jobs/:jobId/checkpoints`
- `POST /v1/jobs/:jobId/resume`
- `GET /v1/jobs/:jobId/artifacts`
- `GET /v1/jobs/:jobId/artifacts/:artifactId/download`
- `POST /v1/jobs/:jobId/artifacts/finalize`

## CLI Commands (V1 scaffold)

- `ohctl job push --file config.json`
- `ohctl job list --status running`
- `ohctl job status <id>`
- `ohctl job logs <id> --tail 200`
- `ohctl job sync <id>`
- `ohctl job cancel <id>`
- `ohctl job checkpoints <id>`
- `ohctl job artifacts <id>`
- `ohctl job artifact get <id> <artifact-id>`
- `ohctl job resume <id> --checkpoint step-1000`
- `ohctl version`

## CLI Release (macOS/Linux/Windows)

- GoReleaser config: `packages/ohforge/.goreleaser.yaml`
- GitHub workflow: `.github/workflows/release-ohctl.yml`
- Publish by pushing a tag:
  - `git tag ohctl-v1.0.0 && git push origin ohctl-v1.0.0`
- Windows users will get `ohctl.exe` in release zip assets.

## CI

- Workflow: `.github/workflows/ci.yml`
- Runs on PRs and pushes to `main`:
  - monorepo typecheck + lint
  - control API smoke test with Postgres
  - `ohctl` build + `ohctl version` on Linux/macOS/Windows

## Operations

- Migration/backup/restore runbook:
  - `docs/OPERATIONS.md`

## DGX Setup

- DGX/SLURM runbook:
  - `scripts/dgx/README.md`
- Includes:
  - systemd service installer for control API
  - sample training script
  - SLURM mode flow
  - Kubernetes mode flow (`SCHEDULER_BACKEND=k8s`)
