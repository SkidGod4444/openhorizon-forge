# User Quickstart (Train-Only)

This is for end users who only need to submit and monitor training jobs.

## 1) Configure CLI

```bash
export OHCTL_API_BASE_URL=http://127.0.0.1:8080
export OHCTL_API_KEY=<your-api-key>
```

## 2) Check access

```bash
ohctl version
ohctl job list
```

## 3) Create job config

`job-config.json`
```json
{
  "script": "/path/to/train.py",
  "framework": "custom",
  "baseModel": "org/model-name",
  "dataset": "/path/to/dataset",
  "gpus": 1,
  "nodes": 1,
  "precision": "bf16",
  "checkpointEvery": 100,
  "requestedBy": "your-name"
}
```

## 4) Submit job

```bash
ohctl job push --file job-config.json
```

## 5) Monitor job

```bash
ohctl job list
ohctl job status <job-id>
ohctl job logs <job-id> --tail 200
ohctl job sync <job-id>
ohctl job checkpoints <job-id>
```

## 6) Register final output artifact

```bash
bash scripts/dgx/finalize_artifact.sh <job-id> /path/to/final/model.safetensors
ohctl job artifacts <job-id>
```

## 7) Resume from checkpoint

```bash
ohctl job resume <job-id> --checkpoint step-1000
```
