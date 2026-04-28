# OpenHorizon Forge - DGX Setup Guide

This guide is the single source of truth to run the project on your DGX server.

## 0) What this system does

- `apps/control`: control-plane API (Hono/TS) that receives job commands.
- `packages/db`: DB schema/bootstrap/migration package.
- `packages/ohforge`: Go CLI (`ohctl`) used by users.

Training lifecycle:
1. User runs `ohctl job push --file config.json`.
2. Control API creates a job record in Postgres.
3. Control API submits runtime job to:
   - `SLURM` (`SCHEDULER_BACKEND=slurm`) OR
   - `Kubernetes Job` (`SCHEDULER_BACKEND=k8s`).
4. User checks status/logs with `ohctl`.
5. Training script outputs final weights.
6. Final artifact is registered via `artifacts/finalize` endpoint (helper script provided).

## 1) Choose runtime backend

Pick one:

- `slurm` mode:
  - Use if your DGX training is scheduled directly with `sbatch`.
- `k8s` mode:
  - Use if your team runs pods/services and wants Kubernetes Jobs.

Set using:
- `SCHEDULER_BACKEND=slurm` or `SCHEDULER_BACKEND=k8s`

## 2) Choose your access model

### Model A: Full server access
- You can install systemd services and manage host paths.
- Follow all sections below.

### Model B: Limited Kubernetes namespace access (your case)
- You can only create resources in your namespace via `kubectl`.
- You should **skip systemd/host setup** and run control API as a Kubernetes Deployment.
- Follow sections `K8s-Only Setup` first.

## 3) Server prerequisites

Install/ensure:
- Git
- Bun
- Go (for CLI build, optional if users only use prebuilt binary)
- Postgres reachable from DGX
- `kubectl` configured (for `k8s` backend) OR SLURM commands (`sbatch`, `squeue`, `sacct`, `scancel`) for `slurm` backend

## 4) Clone project on DGX

```bash
sudo mkdir -p /opt/openhorizon-forge
sudo chown -R "$USER":"$USER" /opt/openhorizon-forge
cd /opt/openhorizon-forge
git clone <your-repo-url> .
```

## 5) Install dependencies

```bash
bun install
```

## 6) Configure environment

### 5.1 DB env

```bash
cp packages/db/.env.example packages/db/.env
```

Edit `packages/db/.env`:
- `DATABASE_URL`
- `DATABASE_MAX_CONNECTIONS`

### 5.2 Control API env

```bash
cp apps/control/.env.example apps/control/.env
```

Edit `apps/control/.env`:

Required:
- `DATABASE_URL`
- `DATABASE_MAX_CONNECTIONS`
- `PORT=8080` (or your choice)
- `CONTROL_API_KEY=<secure-random-key>` (recommended)
- `SLURM_MOCK_MODE=false`
- `SCHEDULER_BACKEND=slurm` or `k8s`

If `SCHEDULER_BACKEND=slurm`:
- `SLURM_SCRIPTS_DIR=/var/lib/openhorizon/slurm`
- `SLURM_LOGS_DIR=/var/log/openhorizon/jobs`

If `SCHEDULER_BACKEND=k8s`:
- `K8S_NAMESPACE=default`
- `K8S_TRAIN_IMAGE=<your-training-image>`

## 7) Initialize DB

```bash
bun run db:init
```

## 8) Start control API as service (recommended for full-access mode)

```bash
sudo bash scripts/dgx/install_control_service.sh
```

Check:
```bash
systemctl status openhorizon-control --no-pager
curl -s http://127.0.0.1:8080/healthz
```

## 9) Build CLI

```bash
bun run cli:build
./bin/ohctl version
```

Set CLI env in shell:
```bash
export OHCTL_API_BASE_URL=http://127.0.0.1:8080
export OHCTL_API_KEY=<same CONTROL_API_KEY>
```

## 10) Create first training job

### 9.1 Prepare sample script

```bash
chmod +x scripts/dgx/sample_train.sh
```

### 9.2 Create config file

`job-config.json`
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

### 9.3 Submit and monitor

```bash
./bin/ohctl job push --file job-config.json
./bin/ohctl job list
./bin/ohctl job status <job-id>
./bin/ohctl job logs <job-id>
./bin/ohctl job sync <job-id>
```

## 11) Register final model artifact

When your real training script creates final output (example: `/mnt/nvme/final/model.safetensors`):

```bash
CONTROL_API_KEY=<same CONTROL_API_KEY> OHCTL_API_BASE_URL=http://127.0.0.1:8080 \
  bash scripts/dgx/finalize_artifact.sh <job-id> /mnt/nvme/final/model.safetensors
```

Then verify:
```bash
./bin/ohctl job artifacts <job-id>
./bin/ohctl job artifact get <job-id> <artifact-id>
```

## 12) Resume from checkpoint

```bash
./bin/ohctl job checkpoints <job-id>
./bin/ohctl job resume <job-id> --checkpoint step-1000
```

## 13) k8s mode verification (if selected)

```bash
kubectl get jobs -n <K8S_NAMESPACE>
kubectl get pods -n <K8S_NAMESPACE>
```

`ohctl job logs <job-id>` reads pod logs via `kubectl logs`.

## 14) slurm mode verification (if selected)

```bash
squeue
sacct -n --format=JobID,State
```

Job stdout/stderr files are written under `SLURM_LOGS_DIR`.

## 15) Common issues

- `Unauthorized` from API:
  - `OHCTL_API_KEY` does not match `CONTROL_API_KEY`.
- Jobs remain queued:
  - check scheduler backend config and scheduler health.
- `kubectl` errors in k8s mode:
  - verify kubeconfig/context and namespace access.
- No logs:
  - run `ohctl job sync <job-id>` first, then fetch logs.

## 16) Minimal production checklist

- `CONTROL_API_KEY` set
- `SLURM_MOCK_MODE=false`
- Correct `SCHEDULER_BACKEND`
- Service managed by systemd
- DB backups enabled
- Release binary (`ohctl`) distributed to users

---

## K8s-Only Setup (Limited Namespace Access)

Use this if you have restricted cluster access and can only create pods/services in your namespace.

### A) Confirm namespace and access

```bash
kubectl config current-context
kubectl auth can-i create deployment -n <your-namespace>
kubectl auth can-i create service -n <your-namespace>
kubectl auth can-i create job -n <your-namespace>
kubectl auth can-i get pods -n <your-namespace>
kubectl auth can-i get jobs -n <your-namespace>
```

### B) Create control API secret in namespace

```bash
kubectl -n <your-namespace> create secret generic openhorizon-control-secrets \
  --from-literal=DATABASE_URL='postgres://...' \
  --from-literal=CONTROL_API_KEY='<secure-key>'
```

### C) Deploy control API and service

Manifests:
- `deploy/k8s/control-deployment.yaml`
- `deploy/k8s/control-service.yaml`

Apply:

```bash
kubectl -n <your-namespace> apply -f deploy/k8s/control-deployment.yaml
kubectl -n <your-namespace> apply -f deploy/k8s/control-service.yaml
kubectl -n <your-namespace> rollout status deployment/openhorizon-control
```

### D) Access API locally via port-forward

```bash
kubectl -n <your-namespace> port-forward svc/openhorizon-control 8080:8080
```

In another terminal:

```bash
export OHCTL_API_BASE_URL=http://127.0.0.1:8080
export OHCTL_API_KEY=<same CONTROL_API_KEY>
./bin/ohctl version
./bin/ohctl job list
```

### E) Job runtime model in k8s backend

- Control API creates a Kubernetes `Job` in your namespace for each training run.
- `ohctl job logs` reads pod logs for that Job.
- `ohctl job sync` maps K8s Job status to platform job status.

### F) Important limitation with restricted access

If your RBAC does not allow creating `Job` resources, training submission will fail.
Ask cluster admin for:
- `create/get/list/watch/delete` on `batch/jobs`
- `get/list/watch` on `pods`
- `get/list/watch` on `pods/log`
