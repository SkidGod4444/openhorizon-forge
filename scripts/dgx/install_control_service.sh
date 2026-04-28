#!/usr/bin/env bash
set -euo pipefail

# Installs OpenHorizon control API as a systemd service on DGX/Linux hosts.
# Run as root:
#   sudo bash scripts/dgx/install_control_service.sh

APP_ROOT="${APP_ROOT:-/opt/openhorizon-forge}"
SERVICE_NAME="${SERVICE_NAME:-openhorizon-control}"
CONTROL_PORT="${CONTROL_PORT:-8080}"
CONTROL_USER="${CONTROL_USER:-openhorizon}"
CONTROL_GROUP="${CONTROL_GROUP:-openhorizon}"

if ! id "${CONTROL_USER}" >/dev/null 2>&1; then
  useradd -r -m -s /usr/sbin/nologin "${CONTROL_USER}"
fi

install -d -o "${CONTROL_USER}" -g "${CONTROL_GROUP}" "${APP_ROOT}"
install -d -o "${CONTROL_USER}" -g "${CONTROL_GROUP}" "${APP_ROOT}/logs"

cat >/etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=OpenHorizon Control API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${CONTROL_USER}
Group=${CONTROL_GROUP}
WorkingDirectory=${APP_ROOT}
Environment=PORT=${CONTROL_PORT}
Environment=SLURM_MOCK_MODE=false
Environment=SLURM_SCRIPTS_DIR=/var/lib/openhorizon/slurm
Environment=SLURM_LOGS_DIR=/var/log/openhorizon/jobs
EnvironmentFile=-${APP_ROOT}/apps/control/.env
ExecStart=/usr/bin/env bun --cwd ${APP_ROOT}/apps/control run dev
Restart=always
RestartSec=3
StandardOutput=append:${APP_ROOT}/logs/control.stdout.log
StandardError=append:${APP_ROOT}/logs/control.stderr.log

[Install]
WantedBy=multi-user.target
EOF

install -d -o "${CONTROL_USER}" -g "${CONTROL_GROUP}" /var/lib/openhorizon/slurm
install -d -o "${CONTROL_USER}" -g "${CONTROL_GROUP}" /var/log/openhorizon/jobs

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"
systemctl status "${SERVICE_NAME}" --no-pager
