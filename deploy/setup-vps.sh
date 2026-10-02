#!/usr/bin/env bash
#
# setup-vps.sh — put the HoloBooth server on a fresh Ubuntu 24.04 VPS
# (any $4–6/month box: 1 vCPU, 1 GB RAM, 25 GB disk is plenty).
#
# It serves the customers' download pages and takes the kiosk's payments and
# uploads, over HTTPS, so QR codes work on any phone and keep working after
# the booth PC is packed away.
#
#   ssh root@YOUR.SERVER.IP
#   curl -fsSL https://raw.githubusercontent.com/a-ch3n/holobooth/main/deploy/setup-vps.sh -o setup-vps.sh
#   sudo bash setup-vps.sh                          # https://<ip-with-dashes>.sslip.io
#   sudo DOMAIN=photos.example.com bash setup-vps.sh # your own domain (A record → this IP first)
#
# Optional: BRANCH=some-branch (default main), STRIPE_SECRET_KEY=sk_... (else
# it asks). Safe to run again — that's how you update: it pulls the latest
# code, reinstalls and restarts, and keeps the existing keys and photos.
#
set -euo pipefail

REPO="${REPO:-https://github.com/a-ch3n/holobooth.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/holobooth
DATA_DIR=/var/lib/holobooth
ENV_FILE=/etc/holobooth.env
PORT=4242

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash $0"; exit 1; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || echo "warning: written for Ubuntu 24.04, this is ${PRETTY_NAME:-unknown} — continuing"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git gnupg openssl debian-keyring debian-archive-keyring apt-transport-https >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  say "Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

if ! command -v caddy >/dev/null; then
  say "Caddy (HTTPS)"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

# A 1 GB box can run out of memory during npm install; a little swap avoids that.
if [ ! -e /swapfile ] && [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ]; then
  say "1 GB swap file"
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

id holobooth >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin holobooth
mkdir -p "$DATA_DIR/media"
chown -R holobooth:holobooth "$DATA_DIR"

say "Code ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
# Server dependencies only — no Electron on a server.
npm ci --omit=dev --no-audit --no-fund --loglevel=error

# ---------------------------------------------------------------- hostname
if [ -z "${DOMAIN:-}" ] && [ -f "$ENV_FILE" ]; then
  DOMAIN="$(sed -n 's#^PUBLIC_URL=https://##p' "$ENV_FILE")"
fi
if [ -z "${DOMAIN:-}" ]; then
  IP="$(curl -4 -fsS https://api.ipify.org)"
  # sslip.io resolves 203-0-113-5.sslip.io to 203.0.113.5 — a free hostname
  # Let's Encrypt will issue a certificate for, so no domain is needed.
  DOMAIN="${IP//./-}.sslip.io"
fi
PUBLIC_URL="https://$DOMAIN"

# ------------------------------------------------------------- secrets env
if [ ! -f "$ENV_FILE" ]; then
  say "Keys"
  if [ -z "${STRIPE_SECRET_KEY:-}" ] && [ -t 0 ]; then
    echo "Stripe secret key (sk_test_... to test with the simulated reader, sk_live_... for the event)."
    read -rsp "Paste it (input hidden), or press Enter to add it later: " STRIPE_SECRET_KEY; echo
  fi
  umask 077
  cat > "$ENV_FILE" <<EOF
# HoloBooth server settings. Edit, then: systemctl restart holobooth
STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY:-}
# The kiosk sends this as x-kiosk-key. It goes in the booth PC's
# config/booth.config.local.json — never in the repo, which is public.
KIOSK_KEY=$(openssl rand -hex 32)
PUBLIC_URL=$PUBLIC_URL
HOST=127.0.0.1
PORT=$PORT
NODE_ENV=production
MEDIA_DIR=$DATA_DIR/media
# Optional:
# STRIPE_WEBHOOK_SECRET=whsec_...   (Dashboard → Webhooks → $PUBLIC_URL/webhooks/stripe)
# STRIPE_READER_ID=tmr_...          (the real WisePOS E / S700, once registered)
# GEMINI_API_KEY=...                (AI character names)
EOF
  chmod 600 "$ENV_FILE"
else
  sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=$PUBLIC_URL#" "$ENV_FILE"
fi

# ----------------------------------------------------------------- service
say "Service"
cat > /etc/systemd/system/holobooth.service <<EOF
[Unit]
Description=HoloBooth server (payments + photo downloads)
After=network-online.target
Wants=network-online.target

[Service]
User=holobooth
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	request_body {
		max_size 50MB
	}
	reverse_proxy 127.0.0.1:$PORT
}
EOF

if command -v ufw >/dev/null && ufw status | grep -q active; then
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

systemctl daemon-reload
systemctl enable -q holobooth caddy
systemctl restart holobooth
systemctl reload caddy 2>/dev/null || systemctl restart caddy

# -------------------------------------------------------------------- check
say "Checking $PUBLIC_URL (the first HTTPS certificate can take a minute)"
ok=
for _ in $(seq 1 30); do
  if curl -fsS "$PUBLIC_URL/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 3
done
if [ -n "$ok" ]; then
  curl -fsS "$PUBLIC_URL/health"; echo
else
  echo "Not answering over HTTPS yet. Look at: journalctl -u holobooth -n 50   and   journalctl -u caddy -n 50"
  echo "Is port 80/443 open in your provider's firewall?"
fi

KEY="$(sed -n 's/^KIOSK_KEY=//p' "$ENV_FILE")"
grep -q '^STRIPE_SECRET_KEY=.\+' "$ENV_FILE" || echo -e "\n!! No Stripe key yet: edit $ENV_FILE, then systemctl restart holobooth"
cat <<EOF

Done. On the booth PC, create config/booth.config.local.json with exactly:

{
  "server": {
    "url": "$PUBLIC_URL",
    "kioskKey": "$KEY"
  }
}

Then restart the kiosk (npm run dev). It no longer needs \`npm run server\`.
Update later: sudo BRANCH=$BRANCH bash setup-vps.sh
Logs:         journalctl -u holobooth -f
EOF
