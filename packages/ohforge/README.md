# `ohctl` (Go CLI)

This package contains the Go CLI for OpenHorizon Forge.

## Why this folder exists

- We keep CLI in `packages/ohforge` so it is easier to version and publish.
- The backend API is separate (`apps/control`), and the CLI only calls HTTP endpoints.

## Folder structure

- `cmd/ohctl/main.go`
  - Program entrypoint.
  - Very small on purpose; it only calls `internal/cli`.
- `internal/cli/cli.go`
  - All command parsing and HTTP request logic.
  - If you want to add a new command, start here.

## Command style

The CLI command name is `ohctl`.

Examples:

- `ohctl job status --job-id ohj_123`
- `ohctl job status ohj_123`

## How it talks to backend

- Default API base URL: `http://localhost:8080`
- Override with env var:
  - `OHFORGE_API_BASE_URL=http://localhost:8080`

## Run and build from repo root

- Run:
  - `bun run cli:run -- job list`
- Build:
  - `bun run cli:build`
  - Output binary: `bin/ohctl`

## Where to modify behavior

- Add/update commands:
  - `packages/ohforge/internal/cli/cli.go`
- Change startup behavior:
  - `packages/ohforge/cmd/ohctl/main.go`
