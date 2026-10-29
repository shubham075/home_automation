#!/usr/bin/env bash
# One-time setup of a pilot hub on a fresh Ubuntu Server 24.04 (x86 mini-PC), run from the repo root:
#   sudo bash hub/deploy/install.sh --phone +919812345678 --name "Ravi Kumar" --site "Sharma Residence" \
#        --city Pune --state Maharashtra --lat 18.5204 --lng 73.8567
# Installs Docker + Avahi (mDNS name sw6hub.local), creates secrets and certificates, starts the hub.
# Containers restart automatically after reboots and crashes.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo."; exit 1; }
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"

echo "== Packages"
apt-get update -y
apt-get install -y ca-certificates curl openssl avahi-daemon nodejs
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker avahi-daemon

echo "== Hostname sw6hub (reachable as sw6hub.local)"
hostnamectl set-hostname sw6hub
systemctl restart avahi-daemon

echo "== Secrets and first owner"
[[ -f hub/.env.prod ]] || node hub/scripts/init-prod.mjs "$@"

echo "== Certificates (hub-local CA)"
LAN_IP="$(hostname -I | awk '{print $1}')"
bash hub/scripts/make-certs.sh "$LAN_IP"

echo "== Broker security"
node hub/scripts/init-broker.mjs --prod

echo "== Build and start"
mkdir -p hub/data/db hub/data/backups hub/data/mosquitto
docker compose -f hub/docker-compose.prod.yml up -d --build

echo
echo "Hub is starting. In a minute:"
echo "  1. On each phone, open http://sw6hub.local/ca.crt (or http://$LAN_IP/ca.crt) and install the certificate."
echo "  2. Open https://sw6hub.local and sign in as the owner (password printed above, also in hub/.env.prod)."
echo "  3. Boards connect to mqtts://sw6hub.local:8883 and trust hub/certs/ca.crt."
