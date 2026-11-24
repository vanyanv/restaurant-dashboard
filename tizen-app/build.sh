#!/usr/bin/env bash
# Package and sign ChrisnEddysTV: ./build.sh <tizen certificate profile>
# Needs the Tizen SDK's `tizen` CLI (found on PATH, or in ~/tizen-sdk, or in $TIZEN_SDK_PATH).
# Writes ChrisnEddysTV.wgt, sssp_config.xml (a business display reads it to install
# the app) and usb/SSSP/ with both, ready to copy to a USB stick.
set -euo pipefail
cd "$(dirname "$0")"
profile="${1:?usage: ./build.sh <certificate profile name>}"
sdk="${TIZEN_SDK_PATH:-$HOME/tizen-sdk}"
command -v tizen >/dev/null || export PATH="$sdk/tools/ide/bin:$PATH"
command -v tizen >/dev/null || { echo "The Tizen SDK isn't installed. See README.md." >&2; exit 1; }

(cd .. && npx tsx scripts/tizen-player.ts)
rm -rf .build usb && mkdir -p .build usb/SSSP
cp config.xml index.html icon.png .build/
tizen package -t wgt -s "$profile" -- .build
wgt=$(find .build -maxdepth 1 -name '*.wgt' | head -1)
[ -n "$wgt" ] || { echo "tizen made no package (is \"$profile\" a signing profile? tizen security-profiles list)" >&2; exit 1; }
mv "$wgt" ChrisnEddysTV.wgt
rm -rf .build

version=$(sed -n 's/.*[^_]version="\([0-9.]*\)" viewmodes.*/\1/p' config.xml)
size=$(wc -c < ChrisnEddysTV.wgt | tr -d ' ')
cat > sssp_config.xml <<XML
<?xml version="1.0" encoding="UTF-8"?>
<widget>
  <ver>${version}</ver>
  <size>${size}</size>
  <widgetname>ChrisnEddysTV</widgetname>
  <webtype>tizen</webtype>
</widget>
XML
cp ChrisnEddysTV.wgt sssp_config.xml usb/SSSP/
echo "Built ChrisnEddysTV.wgt ${version} (${size} bytes). For a USB stick, copy usb/SSSP to its top level."
