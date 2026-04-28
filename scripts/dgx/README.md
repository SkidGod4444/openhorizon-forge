# DGX Runtime Setup

This folder contains scripts to run the control plane against a DGX/SLURM environment.

## 1) Prerequisites on DGX server

- `slurm` commands available (`sbatch`, `squeue`, `sacct`, `scancel`)
- `bun` installed and available on PATH
- Postgres reachable from server (`DATABASE_URL`)
- Repo checked out on server (recommended path: `/opt/openhorizon-forge`)

## 2) Configure env

Create:
- `apps/control/.env`
- `packages/db/.env`

Minimum required values:
- `DATABASE_URL`
- `DATABASE_MAX_CONNECTIONS`
- `CONTROL_API_KEY` (recommended for production)

Optional DGX-specific runtime values:
- `SLURM_MOCK_MODE=false` (must be false for real jobs)
- `SLURM_SCRIPTS_DIR=/var/lib/openhorizon/slurm`
- `SLURM_LOGS_DIR=/var/log/openhorizon/jobs`
- `SCHEDULER_BACKEND=slurm` or `SCHEDULER_BACKEND=k8s`
- `K8S_NAMESPACE=default` (k8s backend only)
- `K8S_TRAIN_IMAGE=<your-training-image>` (k8s backend only)

## 3) Initialize DB

From repo root:

```bash
bun run db:init
```

## 4) Install control API service

```bash
sudo bash scripts/dgx/install_control_service.sh
```

This creates and starts `openhorizon-control.service`.

## 5) Submit a training job

Use sample entrypoint:

```bash
chmod +x scripts/dgx/sample_train.sh
```

Create `job-config.json`:

```json
{
  "script": "/opt/openhorizon-forge/scripts/dgx/sample_train.sh",
  "framework": "custom",
  "baseModel": "dummy/base-model",
  "dataset": "dummy/dataset",
  "gpus": 1,
  "nodes": 1,
  "precision": "bf16",
  "checkpointEvery": 100,
  "requestedBy": "admin"
}
```

Run:

```bash
OHCTL_API_BASE_URL=http://127.0.0.1:8080 OHCTL_API_KEY=<key> \
  bun run cli:run -- job push --file job-config.json
```

## 6) Register final model output artifact

After training finishes, register actual produced file:

```bash
CONTROL_API_KEY=<key> OHCTL_API_BASE_URL=http://127.0.0.1:8080 \
  bash scripts/dgx/finalize_artifact.sh <job-id> /path/to/final/model.safetensors
```

Then verify:

```bash
bun run cli:run -- job artifacts <job-id>
```

## Notes

- If `SCHEDULER_BACKEND=slurm`:
  - Control API generates an sbatch wrapper per job in `SLURM_SCRIPTS_DIR`.
  - SLURM stdout/stderr are written to `SLURM_LOGS_DIR`.
- If `SCHEDULER_BACKEND=k8s`:
  - Control API generates a Kubernetes Job manifest and applies it with `kubectl`.
  - Job logs are read via `kubectl logs`.
- Resume jobs export `OH_RESUME_CHECKPOINT_PATH` to the training script in both backends.
- Final output registration uses:
  - `POST /v1/jobs/:jobId/artifacts/finalize`
  - helper script: `scripts/dgx/finalize_artifact.sh`
