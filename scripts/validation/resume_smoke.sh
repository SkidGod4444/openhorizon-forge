#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
OHCTL_BIN="${OHCTL_BIN:-${ROOT_DIR}/bin/ohctl}"

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <job-id> <checkpoint-ref>" >&2
  exit 1
fi

JOB_ID="$1"
CHECKPOINT="$2"

echo "Resuming job ${JOB_ID} from ${CHECKPOINT}..."
"${OHCTL_BIN}" job resume "${JOB_ID}" --checkpoint "${CHECKPOINT}"
