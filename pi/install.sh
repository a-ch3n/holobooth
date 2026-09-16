#!/usr/bin/env bash
#
# HoloBooth — Raspberry Pi installer.
#
# Tested against Raspberry Pi OS Bookworm (64-bit) on a Pi 5 and a Pi 4B/4GB.
# Run it on the Pi itself:
#
#   sudo bash pi/install.sh
#
# It is safe to re-run: everything is idempotent.

set -euo pipefail

APP_DIR=/opt/holobooth
DATA_DIR=/var/lib/holobooth
RUN_USER="${SUDO_USER:-pi}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;31m !! %s\033[0m\n' "$1"; }

[[ $EUID -eq 0 ]] || { warn "Run with sudo."; exit 1; }

MODEL="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo unknown)"
say "Installing HoloBooth on: $MODEL (user: $RUN_USER)"
case "$MODEL" in
  *"Pi 5"*|*"Pi 4"*) ;;
  *"Pi 3"*|*"Zero"*) warn "A Pi 3 or Zero has USB 2.0 only. 1080p HDMI capture will be slow or fail — see pi/README-pi.md." ;;
  *) warn "Unrecognised model; continuing anyway." ;;
esac

# ---------------------------------------------------------------- packages
say "Installing packages"
apt-get update -qq
apt-get install -y --no-install-recommends \
  nodejs npm \
  chromium-browser \
  cups cups-client printer-driver-gutenprint \
  v4l-utils \
  python3-gpiozero python3-lgpio \
  fonts-noto-color-emoji \
  curl unclutter

NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
if (( NODE_MAJOR < 18 )); then
  say "Node $NODE_MAJOR is too old — installing Node 20 from NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# ------------------------------------------------------------------ files
say "Copying app to $APP_DIR"
mkdir -p "$APP_DIR" "$DATA_DIR"
# Everything except build junk and the dev-only Electron dependency tree.
tar -C "$SRC_DIR" \
    --exclude=node_modules --exclude=out --exclude=.git --exclude=dist \
    -cf - . | tar -C "$APP_DIR" -xf -

cd "$APP_DIR"
say "Installing runtime dependencies (Electron is skipped — the Pi uses Chromium)"
sudo -u "$RUN_USER" npm install --omit=dev --no-audit --no-fund

chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR" "$DATA_DIR"

# -------------------------------------------------------------- printing
say "Configuring CUPS"
usermod -aG lpadmin "$RUN_USER" || true
systemctl enable --now cups
if lpstat -e >/dev/null 2>&1 && [[ -n "$(lpstat -e 2>/dev/null)" ]]; then
  echo "  printers found: $(lpstat -e | tr '\n' ' ')"
  echo "  set printing.cardPrinterName in config/booth.config.json to one of these"
else
  warn "No printer configured yet. Plug in the dye-sub and run:  lpadmin -p CARD -E -v usb://... -m gutenprint..."
  echo "  or open the CUPS web UI at http://$(hostname -I | awk '{print $1}'):631"
fi

# ---------------------------------------------------------------- camera
say "Checking for a USB capture device"
if v4l2-ctl --list-devices 2>/dev/null | grep -qi .; then
  v4l2-ctl --list-devices 2>/dev/null | sed 's/^/  /'
else
  warn "No V4L2 devices. Plug the HDMI capture card into a BLUE (USB 3.0) port."
fi
usermod -aG video "$RUN_USER" || true
usermod -aG gpio "$RUN_USER" || true

# ---------------------------------------------------------------- display
say "Disabling screen blanking and the mouse cursor"
mkdir -p /etc/X11/xorg.conf.d
cat > /etc/X11/xorg.conf.d/10-blanking.conf <<'EOF'
Section "ServerFlags"
    Option "BlankTime" "0"
    Option "StandbyTime" "0"
    Option "SuspendTime" "0"
    Option "OffTime" "0"
EndSection
EOF
# Wayland (Bookworm default) uses wlr-randr / labwc instead; harmless either way.
raspi-config nonint do_blanking 1 2>/dev/null || true

# ---------------------------------------------------------------- services
say "Installing systemd units"
for unit in kiosk payments gpio chromium; do
  sed "s/User=%i/User=$RUN_USER/" "pi/systemd/holobooth-$unit.service" \
    > "/etc/systemd/system/holobooth-$unit.service"
done
mkdir -p /etc/holobooth
if [[ ! -f /etc/holobooth/stripe.env ]]; then
  cat > /etc/holobooth/stripe.env <<'EOF'
# Put the Stripe secret key here. This file is the only place it should exist.
# STRIPE_SECRET_KEY=sk_live_...
EOF
  chmod 600 /etc/holobooth/stripe.env
fi

systemctl daemon-reload
systemctl enable --now holobooth-kiosk.service
systemctl enable holobooth-chromium.service
systemctl enable holobooth-gpio.service || true
# Payments stays disabled until a key is present — a booth that takes money it
# can't process is worse than one that's clearly offline.
if grep -q '^STRIPE_SECRET_KEY=' /etc/holobooth/stripe.env; then
  systemctl enable --now holobooth-payments.service
else
  warn "No Stripe key in /etc/holobooth/stripe.env — payments service left disabled."
  warn "The booth runs on 'mock' payments until you add one and: systemctl enable --now holobooth-payments"
fi

say "Done"
cat <<EOF

  Kiosk service   http://127.0.0.1:4180/src/index.html
  CUPS admin      http://$(hostname -I | awk '{print $1}'):631
  Logs            journalctl -u holobooth-kiosk -f
  Data            $DATA_DIR   (cards.jsonl, sales.jsonl — back these up)

  Next:
    1. Set printing.cardPrinterName in $APP_DIR/config/booth.config.json
    2. Add part of your capture card's name to camera.preferredLabels
    3. Reboot, or: systemctl start holobooth-chromium

EOF
