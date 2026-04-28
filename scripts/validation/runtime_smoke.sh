#!/usr/bin/env bash
set -euo pipefail

# Runtime smoke:
# - submit job
# - sync/status
# - register artifact
# - list artifacts

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
OHCTL_BIN="${OHCTL_BIN:-${ROOT_DIR}/bin/ohctl}"
API_BASE="${OHCTL_API_BASE_URL:-http://127.0.0.1:8080}"
API_KEY="${OHCTL_API_KEY:-}"

if [[ ! -x "${OHCTL_BIN}" ]]; then
  echo "ohctl binary not found at ${OHCTL_BIN}. run: bun run cli:build" >&2
  exit 1
fi

export OHCTL_API_BASE_URL="${API_BASE}"
if [[ -n "${API_KEY}" ]]; then
  export OHCTL_API_KEY="${API_KEY}"
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

cat >"${WORK_DIR}/job-config.json" <<JSON
{
  "script": "${ROOT_DIR}/scripts/dgx/sample_train.sh",
  "framework": "custom",
  "baseModel": "dummy/base-model",
  "dataset": "dummy/dataset",
  "gpus": 1,
  "nodes": 1,
  "precision": "bf16",
  "checkpointEvery": 100,
  "requestedBy": "smoke-test"
}
JSON

JOB_JSON="$("${OHCTL_BIN}" job push --file "${WORK_DIR}/job-config.json")"
JOB_ID="$(echo "${JOB_JSON}" | sed -n 's/.*"jobId": *"\([^"]*\)".*/\1/p' | head -n1)"
if [[ -z "${JOB_ID}" ]]; then
  echo "failed to parse job id from response" >&2
  echo "${JOB_JSON}" >&2
  exit 1
fi

echo "Submitted job: ${JOB_ID}"
"${OHCTL_BIN}" job sync "${JOB_ID}" || true
"${OHCTL_BIN}" job status "${JOB_ID}"

ARTIFACT_FILE="${WORK_DIR}/final-model.safetensors"
echo "dummy-weights" > "${ARTIFACT_FILE}"
CONTROL_API_KEY="${OHCTL_API_KEY:-}" OHCTL_API_BASE_URL="${API_BASE}" \
  bash "${ROOT_DIR}/scripts/dgx/finalize_artifact.sh" "${JOB_ID}" "${ARTIFACT_FILE}"

"${OHCTL_BIN}" job artifacts "${JOB_ID}"
echo "Runtime smoke test completed."
