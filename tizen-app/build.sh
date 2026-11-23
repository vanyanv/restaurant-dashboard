#!/usr/bin/env bash
# Package and sign the Screens app: ./build.sh <tizen certificate profile>
# Needs Tizen Studio's `tizen` CLI on PATH. Writes Screens.wgt and fills in
# sssp_config.xml with its size (business displays read that to install it).
set -euo pipefail
cd "$(dirname "$0")"
profile="${1:?usage: ./build.sh <certificate profile name>}"
rm -rf .build && mkdir .build
cp config.xml index.html icon.png .build/
tizen package -t wgt -s "$profile" -- .build
mv .build/*.wgt Screens.wgt
rm -rf .build
size=$(wc -c < Screens.wgt | tr -d ' ')
cat > sssp_config.xml <<XML
<?xml version="1.0" encoding="UTF-8"?>
<widget>
  <ver>1.0.0</ver>
  <size>${size}</size>
  <widgetname>Screens</widgetname>
</widget>
XML
echo "Built Screens.wgt (${size} bytes) and sssp_config.xml"
