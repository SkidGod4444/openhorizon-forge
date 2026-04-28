#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
OHCTL_BIN="${OHCTL_BIN:-${ROOT_DIR}/bin/ohctl}"
COUNT="${1:-8}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

for i in $(seq 1 "${COUNT}"); do
  cat >"${WORK_DIR}/job-${i}.json" <<JSON
{
  "script": "${ROOT_DIR}/scripts/dgx/sample_train.sh",
  "framework": "custom",
  "baseModel": "dummy/base-model",
  "dataset": "dummy/dataset",
  "gpus": 1,
  "nodes": 1,
  "precision": "bf16",
  "checkpointEvery": 100,
  "requestedBy": "concurrency-test-${i}"
}
JSON
done

echo "Submitting ${COUNT} jobs..."
for i in $(seq 1 "${COUNT}"); do
  "${OHCTL_BIN}" job push --file "${WORK_DIR}/job-${i}.json" > "${WORK_DIR}/resp-${i}.json" || true
done

echo "Submitted jobs summary:"
for i in $(seq 1 "${COUNT}"); do
  JOB_ID="$(sed -n 's/.*"jobId": *"\([^"]*\)".*/\1/p' "${WORK_DIR}/resp-${i}.json" | head -n1)"
  echo "  ${i}: ${JOB_ID:-<failed>}"
done

"${OHCTL_BIN}" job list --limit 100 || true
echo "Concurrency submission test completed."
