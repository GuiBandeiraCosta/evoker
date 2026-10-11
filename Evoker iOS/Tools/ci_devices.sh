#!/usr/bin/env bash
# CI helper (macOS): build the app and its UI tests once, then run them on several iPhone models and export the
# screenshots per model. Usage (from "Evoker iOS"):
#   Tools/ci_devices.sh <out-dir> <full-model> [<other-model> ...]
# The first model runs the whole EvokerUITests suite; the others run the screen tour and the drag test
# (test02MainScreens, test03CardsSliderAndDrag). Writes <out-dir>/<model>/*.png + manifest.json + test.log and
# <out-dir>/summary.txt (one line per model: PASS / FAIL / MISSING).
set -uo pipefail
OUT="$1"; shift
FULL="$1"
DERIVED="${RUNNER_TEMP:-/tmp}/DerivedData-devices"
mkdir -p "$OUT"
SUMMARY="$OUT/summary.txt"
: > "$SUMMARY"

echo "== xcodebuild build-for-testing"
xcodebuild -project Evoker.xcodeproj -scheme Evoker -configuration Debug \
  -destination "generic/platform=iOS Simulator" -derivedDataPath "$DERIVED" \
  OTHER_SWIFT_FLAGS='$(inherited) -continue-building-after-errors' \
  build-for-testing > "$OUT/build.log" 2>&1
BUILD=$?
grep -E "error:|BUILD SUCCEEDED|TEST BUILD SUCCEEDED|BUILD FAILED" "$OUT/build.log" | tail -40
if [ $BUILD -ne 0 ]; then
  echo "BUILD FAILED" >> "$SUMMARY"
  exit 0
fi

python3 Tools/ci_sims.py "$@" > "$OUT/sims.txt"
cat "$OUT/sims.txt"
while IFS='|' read -r status a b c; do
  if [ "$status" != "OK" ]; then
    echo "MISSING  $a ($b)" >> "$SUMMARY"
    continue
  fi
  UDID="$a"; NAME="$b"; RUNTIME="$c"
  SAFE="$(echo "$NAME" | tr ' ' '-')"
  mkdir -p "$OUT/$SAFE"
  ONLY=(-only-testing:EvokerUITests)
  if [ "$NAME" != "$FULL" ]; then
    ONLY=(-only-testing:EvokerUITests/EvokerScreensUITests/test02MainScreens -only-testing:EvokerUITests/EvokerScreensUITests/test03CardsSliderAndDrag)
  fi
  echo "== $NAME ($RUNTIME) $UDID"
  xcrun simctl boot "$UDID" < /dev/null 2>/dev/null || true
  xcodebuild -project Evoker.xcodeproj -scheme Evoker -configuration Debug \
    -destination "id=$UDID" -derivedDataPath "$DERIVED" \
    -resultBundlePath "$OUT/$SAFE/ui.xcresult" "${ONLY[@]}" \
    test-without-building < /dev/null > "$OUT/$SAFE/test.log" 2>&1
  RES=$?
  grep -E "Test Case .*(passed|failed)|error:|TEST (SUCCEEDED|FAILED)" "$OUT/$SAFE/test.log" | sed "s/^/  /" | tail -20
  xcrun xcresulttool export attachments --path "$OUT/$SAFE/ui.xcresult" --output-path "$OUT/$SAFE" < /dev/null > /dev/null 2>&1 || true
  rm -rf "$OUT/$SAFE/ui.xcresult"
  if [ $RES -eq 0 ]; then echo "PASS     $NAME ($RUNTIME)" >> "$SUMMARY"; else echo "FAIL     $NAME ($RUNTIME)" >> "$SUMMARY"; fi
  xcrun simctl shutdown "$UDID" < /dev/null 2>/dev/null || true
done < "$OUT/sims.txt"
echo "== summary"
cat "$SUMMARY"
