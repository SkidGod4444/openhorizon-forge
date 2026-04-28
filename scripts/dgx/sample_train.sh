#!/usr/bin/env bash
set -euo pipefail

# Sample training entrypoint used by OpenHorizon sbatch wrapper.
# Control API exports:
# - OH_SCRIPT_PATH
# - OH_RESUME_CHECKPOINT_PATH (only for resumed jobs)

echo "[sample_train] host=$(hostname) date=$(date -Iseconds)"
echo "[sample_train] script_path=${OH_SCRIPT_PATH:-unset}"
echo "[sample_train] resume_checkpoint=${OH_RESUME_CHECKPOINT_PATH:-none}"

# Replace this block with your actual training command.
# Example:
# python train.py --config config.yaml ${OH_RESUME_CHECKPOINT_PATH:+--resume-from "$OH_RESUME_CHECKPOINT_PATH"}
sleep 5
echo "[sample_train] done"
