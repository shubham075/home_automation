#!/usr/bin/env bash
# Hub-local certificate authority + server certificate for the broker (8883) and the app (443).
# Usage: bash hub/scripts/make-certs.sh [hub-LAN-IP ...]
#   An existing CA is kept (boards and phones trust it); only the server certificate is re-issued.
set -euo pipefail
cd "$(dirname "$0")/../certs" 2>/dev/null || { mkdir -p "$(dirname "$0")/../certs"; cd "$(dirname "$0")/../certs"; }
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: keep "/CN=..." as is

if [[ ! -f ca.key ]]; then
  openssl ecparam -name prime256v1 -genkey -noout -out ca.key
  openssl req -x509 -new -key ca.key -sha256 -days 3650 -out ca.crt \
    -subj "/O=SW6 Home Hub/CN=SW6 Hub Local CA $(date +%Y%m%d)" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
  chmod 600 ca.key
  echo "Created new CA: certs/ca.crt (install on phones; pin in firmware)"
fi

SAN="DNS:sw6hub.local,DNS:sw6hub,DNS:localhost,DNS:mosquitto,IP:127.0.0.1"
for ip in "$@"; do SAN="$SAN,IP:$ip"; done

openssl ecparam -name prime256v1 -genkey -noout -out server.key
openssl req -new -key server.key -out server.csr -subj "/O=SW6 Home Hub/CN=sw6hub.local"
# 825 days: the maximum Apple platforms accept for TLS server certificates.
printf "subjectAltName=%s\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature\nbasicConstraints=CA:FALSE\n" "$SAN" > server.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -sha256 -days 825 -out server.crt -extfile server.ext
rm -f server.csr server.ext
# The broker runs as uid 1883 inside its container; this box is a dedicated hub.
chmod 644 server.key server.crt ca.crt

openssl verify -CAfile ca.crt server.crt
echo "Server certificate for: $SAN (valid 825 days)"
