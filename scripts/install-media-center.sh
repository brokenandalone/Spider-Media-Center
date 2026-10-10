#!/usr/bin/env bash
# Upgrade the existing Media Center app without replacing its Electron runtime.
set -Eeuo pipefail
package_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
target=/opt/spider-media-center/resources/app.asar
cd "$package_root"
test -s app.asar && test -s SHA256SUMS || { echo 'Incomplete Media Center build.' >&2; exit 1; }
sha256sum --strict -c SHA256SUMS
if [[ "${1:-}" == --check ]]; then echo 'Media Center package checks passed.'; exit 0; fi
[[ $# -eq 0 ]] || { echo 'Usage: sudo bash install-media-center.sh (or --check)' >&2; exit 1; }
[[ $EUID -eq 0 ]] || { echo 'Run the installer with sudo from your desktop account.' >&2; exit 1; }
test -f "$target" && test ! -L "$target" || { echo 'Existing Media Center app.asar was not found; install its Electron application first.' >&2; exit 1; }
command -v python3 >/dev/null
# A running process must keep its original archive until it exits.
python3 - <<'PY'
from pathlib import Path
for proc in Path('/proc').glob('[0-9]*'):
    try:
        executable = (proc / 'exe').resolve(strict=True)
    except (OSError, RuntimeError):
        continue
    if executable.is_relative_to('/opt/spider-media-center'):
        raise SystemExit('Close Spider Media Center completely, then run the installer again.')
PY
if ! command -v ffmpeg >/dev/null; then apt-get install -y ffmpeg; fi
backup="$target.before-playback-$(date +%Y%m%d-%H%M%S)-$$"
cp -a -- "$target" "$backup"
temporary="$(mktemp /opt/spider-media-center/resources/.app.asar.XXXXXX)"
trap 'rm -f -- "$temporary"' EXIT
install -m644 -- app.asar "$temporary"
cmp -- app.asar "$temporary"
mv -f -- "$temporary" "$target"
echo "Installed Media Center playback build. Backup: $backup"
echo 'Open Spider Media Center and test Play/Pause/seek, a local movie and Prepare and play here.'
echo "Rollback with Media Center closed: sudo cp -a -- '$backup' '$target'"
