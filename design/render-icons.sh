#!/bin/bash
# Renders icons/*.png from design/icon.svg using headless Chrome (macOS).
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
tmp=$(mktemp -d)
python3 - "$tmp" <<'PY'
import sys
out = sys.argv[1]
s = open('design/icon.svg').read()
body = s[s.index('>', s.index('<svg')) + 1:s.rindex('</svg>')]
bg = '<rect width="512" height="512" fill="#f3ead7"/>'
svg = lambda n, c: f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="{n}" height="{n}">{c}</svg>'
for n in (512, 192, 180):
    open(f'{out}/any{n}.svg', 'w').write(svg(n, body))
# Maskable: shrink the artwork into the 80% safe circle.
open(f'{out}/maskable.svg', 'w').write(svg(512, bg + '<g transform="translate(256 256) scale(0.86) translate(-256 -256)">' + body.replace(bg, '') + '</g>'))
PY
shot() { "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size="$2,$2" --screenshot="$3" "file://$tmp/$1" >/dev/null 2>&1; }
shot any512.svg 512 icons/icon-512.png
shot any192.svg 192 icons/icon-192.png
shot any180.svg 180 icons/apple-touch-icon.png
shot maskable.svg 512 icons/maskable-512.png
rm -r "$tmp"
