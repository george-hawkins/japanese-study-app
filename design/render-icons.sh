#!/bin/bash
# Renders icons/*.png from design/icon.svg using headless Chrome (macOS).
#
# icon.svg has a transparent background. Most icons keep that; the two that
# platforms require to be opaque get the cream splash colour behind them:
# - apple-touch-icon.png: iOS fills transparency with black.
# - maskable-512.png: Android crops it to the launcher's shape and expects it
#   to fill that edge to edge.
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
def svg(n, content, box='0 0 512 512'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}" width="{n}" height="{n}">{content}</svg>'
for n in (512, 192):
    open(f'{out}/any{n}.svg', 'w').write(svg(n, body))
open(f'{out}/apple.svg', 'w').write(svg(180, bg + body))
# Maskable: shrink the artwork into the 80% safe circle.
open(f'{out}/maskable.svg', 'w').write(svg(512, bg + '<g transform="translate(256 256) scale(0.86) translate(-256 -256)">' + body + '</g>'))
# Favicon: cropped to the daruma and its shadow so it's legible at 16 px.
open(f'{out}/favicon.svg', 'w').write(svg(96, body, '54 64 404 404'))
PY
shot() { "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --default-background-color=00000000 --window-size="$2,$2" --screenshot="$3" "file://$tmp/$1" >/dev/null 2>&1; }
shot any512.svg 512 icons/icon-512.png
shot any192.svg 192 icons/icon-192.png
shot apple.svg 180 icons/apple-touch-icon.png
shot maskable.svg 512 icons/maskable-512.png
shot favicon.svg 96 icons/favicon.png
rm -r "$tmp"
