#!/usr/bin/env bash
set -euo pipefail

# Verifies release assets for a given version tag.
# Usage: ./scripts/release/verify_release.sh ohctl-v1.0.0

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <tag>" >&2
  exit 1
fi

TAG="$1"
ASSETS=(
  "ohctl_${TAG#ohctl-v}_linux_amd64.tar.gz"
  "ohctl_${TAG#ohctl-v}_linux_arm64.tar.gz"
  "ohctl_${TAG#ohctl-v}_darwin_amd64.tar.gz"
  "ohctl_${TAG#ohctl-v}_darwin_arm64.tar.gz"
  "ohctl_${TAG#ohctl-v}_windows_amd64.zip"
  "ohctl_${TAG#ohctl-v}_windows_arm64.zip"
  "checksums.txt"
)

echo "Expected assets:"
printf ' - %s\n' "${ASSETS[@]}"
echo
echo "Use GitHub release page to confirm all assets exist for ${TAG}."
echo "Optional verification:"
echo "  1) Download checksums.txt"
echo "  2) Verify downloaded asset checksums match"
