#!/bin/sh
# Build phase of the EvokerWeb target (Xcode runs it with /bin/sh): copies the files the web game loads at run time
# (index.html, css, src, data, assets; see Evoker Web/index.html) from "../Evoker Web" into the app bundle's Game
# folder, which EvokerWeb/LocalGameServer.swift serves. The web project stays the single source.
set -eu
SRC="${SRCROOT}/../Evoker Web"
DST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/Game"
if [ ! -f "$SRC/index.html" ]; then
  echo "error: Evoker Web not found at $SRC" >&2
  exit 1
fi
mkdir -p "$DST"
rsync -a --delete --exclude ".DS_Store" --exclude "*.md" \
  "$SRC/index.html" "$SRC/css" "$SRC/src" "$SRC/data" "$SRC/assets" "$DST/"
COUNT=$(find "$DST" -type f | wc -l | tr -d ' ')
echo "Copied Evoker Web into $DST ($COUNT files)"
