# OpenHorizon Forge Tasks

Status legend:
- `[x]` Completed
- `[-]` In progress
- `[ ]` Pending

## Product Scope (Train-Only)
- [x] Confirm train-only scope (no deployment/inference feature)
- [x] Remove deploy API/CLI surfaces from active docs and command usage
- [x] Remove unused deploy DB table and old references after migration window

## Monorepo & Foundations
- [x] Turborepo + Bun workspace setup
- [x] Hono control API scaffold
- [x] Shared contracts package
- [x] Standalone DB package (`packages/db`)
- [x] Go CLI package (`packages/ohforge`) with `ohctl` commands

## Training Control Plane
- [x] Create/list/status/cancel/sync jobs
- [x] Scheduler adapter with mock mode + SLURM integration points
- [x] Kubernetes scheduler backend option (`SCHEDULER_BACKEND=k8s`)
- [x] Logs/events endpoints
- [x] Checkpoint listing and resume-from-checkpoint
- [x] Artifact metadata table and artifact APIs
- [x] Final artifact generation from real training output path (artifact finalize API + DGX helper script)
- [x] Robust status reconciliation loop (poller/worker instead of on-demand sync)

## Security
- [x] Optional API key auth in control API (`CONTROL_API_KEY`)
- [x] CLI bearer auth support (`OHCTL_API_KEY`)
- [ ] Team/user model + RBAC
- [ ] Secret manager integration (Vault/KMS) for production

## CLI (`ohctl`)
- [x] Core job commands
- [x] Short-style positional IDs (`ohctl job status <job-id>`)
- [x] Artifact commands
- [x] `ohctl version` command with build metadata
- [x] Shell completion scripts (bash/zsh/powershell)
- [x] Better UX output formatting (tables + concise summaries)

## Database & Migrations
- [x] Drizzle schema + bootstrap init
- [x] Migration generation and migrate flow
- [x] Add forward-only production migration policy doc
- [x] Add backup/restore runbook

## CI/CD & Releases
- [x] CI workflow: lint/typecheck/api smoke
- [x] Cross-platform CLI checks (Linux/macOS/Windows)
- [x] GoReleaser workflow for tagged releases
- [x] Windows release artifacts (`ohctl.exe` in zip)
- [ ] Add signed checksums + provenance/SBOM
- [ ] Add staged release process (rc -> stable)

## Docs
- [x] Root README quickstart
- [x] CLI README
- [x] Environment variable reference (what each env var is used for)
- [x] Task tracker (`TASKS.md`)
- [-] Operator deployment guide (DGX + SLURM + Postgres + MinIO)
- [x] K8s namespace-only setup path for restricted DGX access
- [ ] User quickstart for end-to-end train workflow

## Production Readiness Exit Criteria
- [-] Real training run writes checkpoints and final artifacts end-to-end
- [-] Resume flow validated on failed/interrupted jobs
- [-] 8 concurrent jobs tested with acceptable stability
- [x] Auth enabled and validated in CI
- [-] Release pipeline used to publish at least one tagged version
