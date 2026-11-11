#!/usr/bin/env bash
# Kører end-to-end-testen af Navneleg-udvidelsen.
# Brug: ./run.sh [chrome|firefox|alle]   (standard: alle)
#   CHROME=/sti/til/chrome FIREFOX=/sti/til/firefox ./run.sh
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
WHICH="${1:-alle}"
CHROME="${CHROME:-$(ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null | sort -V | tail -1)}"
FIREFOX="${FIREFOX:-$(command -v firefox || true)}"
PORT=8443
PROXY=8444

"$ROOT/build.sh" > /dev/null
[ -f cert.pem ] || openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=www.lectio.dk" 2>/dev/null
python3 -I fixture.py fix
: > requests.log; : > proxy.log
python3 -I server.py "$PWD/fix" $PORT > server.out 2>&1 &
PIDS=($!)
python3 -I proxy.py $PROXY $PORT > proxy.out 2>&1 &
PIDS+=($!)
trap 'kill "${PIDS[@]}" 2>/dev/null' EXIT
sleep 1

STATUS=0
if [[ "$WHICH" == chrome || "$WHICH" == alle ]]; then
  echo "################ CHROME ################"
  node test.mjs chrome "$CHROME" "$ROOT/navnleg-extension" $PORT || STATUS=1
fi
if [[ "$WHICH" == firefox || "$WHICH" == alle ]]; then
  echo "################ FIREFOX ################"
  : > requests.log
  node test.mjs firefox "$FIREFOX" "$ROOT/dist/firefox" $PORT $PROXY || STATUS=1
  echo "Proxy afviste: $(grep -c AFVIST proxy.log || true) forespørgsler til andre værter"
fi
exit $STATUS
