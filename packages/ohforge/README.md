# `ohctl` (Go CLI)

This package contains the Go CLI for OpenHorizon Forge.

## Why this folder exists

- We keep the CLI in `packages/ohforge` so it is easier to version and publish.
- The backend API is separate (`apps/control`); the CLI only calls HTTP endpoints.

## Folder structure

```
packages/ohforge
├── cmd/ohctl/main.go            # Tiny entrypoint (delegates to internal/cli)
└── internal/cli/
    ├── cli.go                   # Root command + persistent flags
    ├── job.go                   # `ohctl job ...` subcommands (incl. watch)
    ├── version.go               # `ohctl version`
    ├── client.go                # HTTP client + API error type
    └── output.go                # json | table | yaml renderer
```

If you want to add a new command, start in `internal/cli/job.go` (or
create a new file beside it). The CLI uses
[`spf13/cobra`](https://github.com/spf13/cobra) so each subcommand is a
standalone `*cobra.Command`.

## Command reference

The CLI binary is named `ohctl`.

```
ohctl
├── version                     # print version/commit/buildDate
├── completion <bash|zsh|fish|powershell>
└── job
    ├── push       --file <path|->          # submit a new job (stdin supported)
    ├── list       [--status …] [--requestedBy …] [--limit 20] [--offset 0]
    ├── status     <job-id>                  # full status payload
    ├── logs       <job-id> [--tail N] [--since RFC3339]
    ├── sync       <job-id>                  # force scheduler state sync
    ├── cancel     <job-id>                  # request cancellation
    ├── checkpoints <job-id>
    ├── artifacts   <job-id>
    ├── artifact get <job-id> <artifact-id>  # signed download URL
    ├── resume     <job-id> --checkpoint <step-N|checkpoint-id>
    └── watch      <job-id> [--interval 3s]  # poll until terminal status
```

`<job-id>` may be passed as a positional argument or via `--job-id`.

## Global flags

| Flag                | Env var                                   | Default                  | Notes                                |
|---------------------|-------------------------------------------|--------------------------|--------------------------------------|
| `--api-base-url`    | `OHCTL_API_BASE_URL` / `OHFORGE_API_BASE_URL` | `http://localhost:8080` | URL of the control plane             |
| `--api-key`         | `OHCTL_API_KEY`                           | _(unset)_                | Sent as `Authorization: Bearer …`    |
| `--output`, `-o`    | `OHCTL_OUTPUT`                            | `json`                   | One of `json`, `table`, `yaml`       |
| `--timeout`         | _(none)_                                  | `30s`                    | HTTP request timeout (`5s`, `1m`, …) |

Flag > env var > default. CLI flags always win.

## Run and build from the repo root

```bash
# Run via go run (no install needed)
bun run cli:run -- job list

# Build a local binary at ./bin/ohctl
bun run cli:build

# Print version
bun run cli:run -- version
```

## Output formats

```bash
# default JSON
ohctl job list

# pretty aligned table (works with paginated `{items: [...]}` payloads)
ohctl -o table job list

# YAML (handy for grep / config bootstrapping)
ohctl -o yaml job status ohj_123

# you can also use the env var
OHCTL_OUTPUT=table ohctl job list
```

## Examples

```bash
# Submit from a config file
ohctl job push --file ./examples/qwen-sft.json

# Submit from stdin
cat job.json | ohctl job push --file -

# Live-watch a job until completion
ohctl job watch ohj_123 --interval 5s

# Resume from a checkpoint step
ohctl job resume ohj_123 --checkpoint step-1000 --requestedBy alice

# Talk to a remote control plane with auth
ohctl --api-base-url https://forge.example.com \
      --api-key $OHCTL_API_KEY \
      -o table \
      job list --status running
```

## Errors and exit codes

- API errors render as `Error: HTTP <code> <path>: <message> (code=<code>)`
  when the server returns the standard `{ "error": { "code", "message" } }`
  shape; otherwise the raw body is shown.
- Any failure exits with code `1`. Use `--timeout` to bound network
  hangs.
- `Ctrl+C` (or `SIGTERM`) is honoured — long commands like
  `ohctl job watch` shut down cleanly.

## Shell completions

Cobra generates rich, subcommand- and flag-aware completions:

```bash
# Bash
ohctl completion bash | sudo tee /etc/bash_completion.d/ohctl

# Zsh
ohctl completion zsh > ~/.zfunc/_ohctl

# Fish
ohctl completion fish > ~/.config/fish/completions/ohctl.fish

# PowerShell
ohctl completion powershell | Out-String | Invoke-Expression
```

## Release distribution (macOS / Linux / Windows)

- GoReleaser config: `packages/ohforge/.goreleaser.yaml`
- GitHub Actions workflow: `.github/workflows/release-ohctl.yml`
- Tag format to publish: `ohctl-v1.0.0`

Windows artifacts are produced as `.zip` and include `ohctl.exe`.

## Where to modify behavior

- Add or update commands → `packages/ohforge/internal/cli/job.go`
  (or a new file in the same package).
- Change root flags / startup wiring → `packages/ohforge/internal/cli/cli.go`.
- Adjust HTTP behaviour (auth, timeouts, headers) → `packages/ohforge/internal/cli/client.go`.
- Tweak rendering (json/table/yaml) → `packages/ohforge/internal/cli/output.go`.
