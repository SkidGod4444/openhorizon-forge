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
- Override with env var (preferred):
  - `OHCTL_API_BASE_URL=http://localhost:8080`
- Backward-compatible alias:
  - `OHFORGE_API_BASE_URL=http://localhost:8080`
- Optional API key for protected control API:
  - `OHCTL_API_KEY=<your-control-api-key>`

## Run and build from repo root

- Run:
  - `bun run cli:run -- job list`
- Build:
  - `bun run cli:build`
  - Output binary: `bin/ohctl`
- Version:
  - `bun run cli:run -- version`

## Release distribution (macOS/Linux/Windows)

- GoReleaser config:
  - `packages/ohforge/.goreleaser.yaml`
- GitHub Actions workflow:
  - `.github/workflows/release-ohctl.yml`
- Tag format to publish:
  - `ohctl-v1.0.0`

Windows artifacts are produced as `.zip` archives and include `ohctl.exe`.

## Where to modify behavior

- Add/update commands:
  - `packages/ohforge/internal/cli/cli.go`
- Change startup behavior:
  - `packages/ohforge/cmd/ohctl/main.go`
