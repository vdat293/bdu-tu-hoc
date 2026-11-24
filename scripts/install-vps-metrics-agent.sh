#!/usr/bin/env bash
set -euo pipefail

# Idempotent installer for read-only BDU VPS telemetry agent.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENT_SRC="${REPO_DIR}/scripts/vps-metrics-agent.py"
AGENT_BIN="/usr/local/bin/bdu-vps-agent.py"
TELEMETRY_DIR="/opt/bdu-tu-hoc/data/vps-telemetry"
SERVICE_FILE="/etc/systemd/system/bdu-vps-agent.service"

if [[ ! -f "$AGENT_SRC" ]]; then
  echo "[install-vps-agent] Missing source file: $AGENT_SRC" >&2
  exit 1
fi

mkdir -p "$TELEMETRY_DIR"
chmod 755 "$TELEMETRY_DIR"

cp "$AGENT_SRC" "$AGENT_BIN"
chmod 755 "$AGENT_BIN"

cat > "$SERVICE_FILE" <<'EOF'
[Unit]
Description=BDU Read-Only VPS Telemetry Snapshot Collector
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 /usr/local/bin/bdu-vps-agent.py --out /opt/bdu-tu-hoc/data/vps-telemetry/snapshot.json --data-dir /opt/bdu-tu-hoc/data --interval 10
Restart=always
RestartSec=5
Nice=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now bdu-vps-agent.service
sleep 2
systemctl is-active bdu-vps-agent.service
ls -la "$TELEMETRY_DIR/snapshot.json"
