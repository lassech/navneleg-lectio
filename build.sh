#!/usr/bin/env bash
# Bygger zip-pakker til Chrome og Firefox ud fra navnleg-extension/.
# Chrome-pakken er mappen som den er. Firefox-pakken får et ekstra
# manifest-felt (browser_specific_settings), som Chrome ellers advarer om.
set -euo pipefail
cd "$(dirname "$0")"
SRC=navnleg-extension
OUT=dist
rm -rf "$OUT"; mkdir -p "$OUT/firefox"
cp -r "$SRC"/content.js "$SRC"/style.css "$SRC"/icons "$OUT/firefox/"
python3 -I - "$SRC/manifest.json" "$OUT/firefox/manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1], encoding="utf-8"))
m["browser_specific_settings"] = {
    "gecko": {
        "id": "{6d9a1014-a27c-4c40-ac8d-ae221bb17977}",
        "strict_min_version": "128.0",
        # Udvidelsen indsamler og sender ingen data
        "data_collection_permissions": {"required": ["none"]},
    }
}
json.dump(m, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
(cd "$SRC" && zip -qr "../$OUT/navnleg-chrome.zip" manifest.json content.js style.css icons)
(cd "$OUT/firefox" && zip -qr "../navnleg-firefox.zip" manifest.json content.js style.css icons)
echo "Bygget:"; ls -1 "$OUT"
