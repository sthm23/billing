#!/bin/bash
# One-time install of the order assistant STT service on the VPS (docs/voice-order/STT_SERVICE.md).
# Run once, as the user who owns /var/www/billing (the same user GitHub Actions deploys with):
#
#   sudo bash /var/www/billing/stt-service/install.sh
#
# Safe to run again (updates the venv and the unit). After this, deploy.sh updates and restarts
# the service by itself whenever stt-service/ changes.
set -euo pipefail

APP_DIR=/var/www/billing
SERVICE=sthm-stt
STT_DIR=/opt/sthm-stt
PORT=8090

if [[ $EUID -ne 0 ]]; then
  echo "❌ Run with sudo: sudo bash $APP_DIR/stt-service/install.sh" >&2
  exit 1
fi
RUN_USER=${SUDO_USER:-$(stat -c %U "$APP_DIR")}
if [[ "$RUN_USER" == "root" ]]; then
  RUN_USER=$(stat -c %U "$APP_DIR")
fi
echo "👤 Service user: $RUN_USER"

echo "🧠 Memory (the model needs ~2.2 GB: 1.6 GB loaded + ~0.5 GB while recognizing):"
free -h
AVAILABLE_MB=$(free -m | awk '/^Mem:/ {print $7}')
if (( AVAILABLE_MB < 2300 )); then
  echo "⚠️  Only ${AVAILABLE_MB} MB available — the service may be killed (MemoryMax=2.4G). Add RAM first." >&2
fi

echo "📦 System packages..."
apt-get install -y python3-venv python3-pip

echo "🐍 Virtualenv in $STT_DIR..."
mkdir -p "$STT_DIR/hf"
chown -R "$RUN_USER" "$STT_DIR"
sudo -u "$RUN_USER" python3 -m venv "$STT_DIR/venv"
sudo -u "$RUN_USER" "$STT_DIR/venv/bin/pip" install --upgrade pip
sudo -u "$RUN_USER" "$STT_DIR/venv/bin/pip" install -r "$APP_DIR/stt-service/requirements.txt"

echo "⚙️  systemd unit..."
cat > "/etc/systemd/system/$SERVICE.service" <<UNIT
[Unit]
Description=STHM order assistant speech-to-text
After=network.target

[Service]
User=$RUN_USER
WorkingDirectory=$APP_DIR/stt-service
Environment=HF_HOME=$STT_DIR/hf
Environment=STT_THREADS=2
Environment=STT_QUEUE_SIZE=3
ExecStart=$STT_DIR/venv/bin/uvicorn app:app --host 127.0.0.1 --port $PORT --workers 1
Restart=always
RestartSec=5
# Never starve NestJS / PostgreSQL on the shared VPS
MemoryMax=2.4G
CPUQuota=150%
Nice=10

[Install]
WantedBy=multi-user.target
UNIT

echo "🔑 Let $RUN_USER restart the service without a password (deploy.sh)..."
SUDOERS=/etc/sudoers.d/$SERVICE
echo "$RUN_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart $SERVICE, /usr/bin/systemctl status $SERVICE" > "$SUDOERS"
chmod 440 "$SUDOERS"
visudo -cf "$SUDOERS"

systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"

echo "⏳ Waiting for the model (first start downloads ~1.5 GB)..."
for _ in $(seq 1 720); do
  if curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"ok"'; then
    echo "✅ STT service is up: $(curl -s "http://127.0.0.1:$PORT/health")"
    exit 0
  fi
  sleep 5
done

echo "❌ STT service did not become ready in 60 min. Logs:" >&2
journalctl -u "$SERVICE" -n 50 --no-pager >&2
exit 1
