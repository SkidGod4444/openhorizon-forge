#!/usr/bin/env bash
set -euo pipefail

# Registers a real training output artifact with the control API.
#
# Required args:
#   1) job id
#   2) artifact file path
# Optional env:
#   OHCTL_API_BASE_URL (default: http://127.0.0.1:8080)
#   CONTROL_API_KEY (for protected API)
#
# Example:
#   bash scripts/dgx/finalize_artifact.sh ohj_123 /mnt/nvme/checkpoints/final/model.safetensors

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <job-id> <artifact-path>" >&2
  exit 1
fi

JOB_ID="$1"
ARTIFACT_PATH="$2"
API_BASE_URL="${OHCTL_API_BASE_URL:-http://127.0.0.1:8080}"
NAME="$(basename "$ARTIFACT_PATH")"
FORMAT="${NAME##*.}"
SIZE_BYTES="$(stat -c%s "$ARTIFACT_PATH" 2>/dev/null || stat -f%z "$ARTIFACT_PATH")"
CHECKSUM="$(sha256sum "$ARTIFACT_PATH" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$ARTIFACT_PATH" | awk '{print $1}')"

AUTH_HEADER=()
if [[ -n "${CONTROL_API_KEY:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${CONTROL_API_KEY}")
fi

curl -sSf \
  "${AUTH_HEADER[@]}" \
  -H "Content-Type: application/json" \
  -X POST "${API_BASE_URL}/v1/jobs/${JOB_ID}/artifacts/finalize" \
  -d "$(cat <<JSON
{
  "name": "${NAME}",
  "kind": "final_model",
  "format": "${FORMAT}",
  "storagePath": "${ARTIFACT_PATH}",
  "sizeBytes": ${SIZE_BYTES},
  "checksumSha256": "${CHECKSUM}"
}
JSON
)"
