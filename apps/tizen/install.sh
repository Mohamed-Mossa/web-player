#!/usr/bin/env bash
# Installs the IPTV Player on a Samsung TV (2020 or newer) from macOS or Linux.
# One-time setup: see apps/tizen/README.md.
#
#   ./install.sh 192.168.1.50                    # downloads the latest build from GitHub
#   ./install.sh 192.168.1.50 ./tizen-app.zip
#   PROFILE=mytv ./install.sh 192.168.1.50       # certificate profile name, default "iptv"
set -euo pipefail
TV_IP="${1:?usage: install.sh <tv-ip> [tizen-app.zip]}"
ZIP="${2:-}"
PROFILE="${PROFILE:-iptv}"
APP_ID="IptvMousa1.IPTVPlayer"
RELEASE="https://github.com/Mohamed-Mossa/web-player/releases/download/tizen-latest/tizen-app.zip"
# Tizen CLI and sdb: Tizen Studio (older) or the newer Tizen SDK used by the VS Code extension
find_tool() { # name
  command -v "$1" 2>/dev/null && return
  for root in "${TIZEN_STUDIO:-}" "$HOME/tizen-studio" "$HOME/tizen-sdk" /opt/tizen-studio /opt/tizen-sdk; do
    [ -n "$root" ] && [ -d "$root" ] || continue
    for p in "$root/tools/ide/bin/$1" "$root/tools/$1"; do [ -x "$p" ] && { echo "$p"; return; }; done
    p="$(find "$root" -maxdepth 5 -type f -name "$1" -perm -u+x 2>/dev/null | head -1)"
    [ -n "$p" ] && { echo "$p"; return; }
  done
}
TIZEN="$(find_tool tizen || true)"
SDB="$(find_tool sdb || true)"
[ -n "$TIZEN" ] && [ -n "$SDB" ] || { echo "Tizen CLI/sdb not found. Install Tizen Studio or the Tizen SDK, or set TIZEN_STUDIO=<its folder>."; exit 1; }
echo "Using $TIZEN"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
if [ -z "$ZIP" ]; then
  echo "Downloading the latest build..."
  ZIP="$WORK/tizen-app.zip"
  curl -fL "$RELEASE" -o "$ZIP"
fi
mkdir "$WORK/app"
unzip -q "$ZIP" -d "$WORK/app"

echo "Signing with certificate profile '$PROFILE'..."
"$TIZEN" package -t wgt -s "$PROFILE" -- "$WORK/app"
WGT="$(cd "$WORK/app" && ls *.wgt | head -1)"

echo "Connecting to the TV at $TV_IP..."
"$SDB" connect "$TV_IP"
SERIAL="$TV_IP:26101"
"$SDB" -s "$SERIAL" get-state >/dev/null || { echo "The TV refused the connection. Is Developer Mode on, with this computer's IP as the host?"; exit 1; }

echo "Installing..."
"$TIZEN" install -n "$WGT" -s "$SERIAL" -- "$WORK/app"
"$TIZEN" run -p "$APP_ID" -s "$SERIAL"
echo 'Done. The app is in the TV'"'"'s Apps list as "IPTV Player".'
