#!/usr/bin/env bash
# One transaction: V7 Media Center archive + the existing V6 native Nova DJ.
# Must be run from the verified GitHub Actions release bundle, as the desktop user.
set -Eeuo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
NOVA_OS_COMMIT='980fccf98e4dfdfdb27b32a49c46158ca752a79c'
NOVA_OS_REPO='brokenandalone/spider-narive-os'
NOVA_TARGET='/usr/local/lib/spider-os/media/ai-dj'
MEDIA_TARGET='/opt/spider-media-center/resources/app.asar'
[[ $# -eq 1 && "$1" == --install ]] || { echo 'Usage: bash install-v7-with-v6-nova.sh --install' >&2; exit 2; }
[[ "$EUID" -ne 0 ]] || { echo 'Run as the desktop user, not root (sudo is requested for protected files).' >&2; exit 1; }
command -v sudo >/dev/null && command -v curl >/dev/null && command -v python3 >/dev/null && command -v systemctl >/dev/null ||
 { echo 'Requires sudo, curl, python3 and systemctl.' >&2; exit 1; }
[[ -f "$NOVA_TARGET/service.py" && ! -L "$NOVA_TARGET/service.py" ]] ||
 { echo 'Native V6 Nova service does not exist on Spider OS. No changes made.' >&2; exit 1; }
[[ -f "$MEDIA_TARGET" && ! -L "$MEDIA_TARGET" ]] ||
 { echo 'Existing Media Center app is missing. No changes made.' >&2; exit 1; }
bash "$ROOT/install-v7-preview.sh" --check
# Running desktop user owns the user-level DJ unit.
systemctl --user list-unit-files spider-ai-dj.service >/dev/null 2>&1 ||
 { echo 'Existing spider-ai-dj.service not found.' >&2; exit 1; }
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT
mkdir -p "$WORK/nova"
for filename in nova_host.py service.py; do
  curl --fail --location --silent --show-error --retry 3 \
    "https://raw.githubusercontent.com/$NOVA_OS_REPO/$NOVA_OS_COMMIT/media/ai-dj/$filename" \
    -o "$WORK/nova/$filename"
  [[ -s "$WORK/nova/$filename" ]] || { echo "Nova download empty: $filename" >&2; exit 1; }
done
PYTHONPYCACHEPREFIX="$WORK/python-cache" python3 -m py_compile "$WORK/nova/"*.py
# Backups of both Nova files are prepared before any installation.
STORAGE="$HOME/Studio/Media/SpiderMediaCenter/v7/paired-backups"
mkdir -p -m700 -- "$STORAGE"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
NOVA_BACKUP="$STORAGE/nova-$STAMP"
mkdir -m700 -- "$NOVA_BACKUP"
sudo cp -a -- "$NOVA_TARGET/service.py" "$NOVA_BACKUP/service.py"
HAD_PERSONA=no
if [[ -f "$NOVA_TARGET/nova_host.py" && ! -L "$NOVA_TARGET/nova_host.py" ]]; then
  HAD_PERSONA=yes
  sudo cp -a -- "$NOVA_TARGET/nova_host.py" "$NOVA_BACKUP/nova_host.py"
fi
[[ -s "$NOVA_BACKUP/service.py" ]] || { echo 'Nova backup missing.' >&2; exit 1; }
# Keep a second independently verified archive snapshot for paired rollback.
MEDIA_BACKUP="$STORAGE/app.asar.$STAMP"
sudo cp -a -- "$MEDIA_TARGET" "$MEDIA_BACKUP"
sudo cmp -s -- "$MEDIA_TARGET" "$MEDIA_BACKUP" ||
 { echo 'Media backup verification failed. Installation aborted.' >&2; exit 1; }
installed=no
rollback(){
  echo 'Restoring previous Media Center and Nova components.' >&2
  sudo install -m644 -- "$MEDIA_BACKUP" "$MEDIA_TARGET" || true
  sudo install -m644 -- "$NOVA_BACKUP/service.py" "$NOVA_TARGET/service.py" || true
  if [[ "$HAD_PERSONA" == yes ]]; then
    sudo install -m644 -- "$NOVA_BACKUP/nova_host.py" "$NOVA_TARGET/nova_host.py" || true
  else
    sudo rm -f -- "$NOVA_TARGET/nova_host.py" || true
  fi
  systemctl --user restart spider-ai-dj.service || true
}
on_exit(){
  local result=$?
  trap - EXIT
  if [[ "$installed" == yes && "$result" -ne 0 ]]; then rollback; fi
  rm -rf -- "$WORK"
  exit "$result"
}
trap on_exit EXIT
# Validate media process closure and archive digest, then install only V7 app.asar.
sudo bash "$ROOT/install-v7-preview.sh" --install
installed=yes
sudo install -m644 -- "$WORK/nova/nova_host.py" "$NOVA_TARGET/nova_host.py"
sudo install -m644 -- "$WORK/nova/service.py" "$NOVA_TARGET/service.py"
systemctl --user restart spider-ai-dj.service
python3 - <<'PY'
import json,time,urllib.request
for _ in range(6):
    try:
        with urllib.request.urlopen('http://127.0.0.1:9876/health',timeout=3) as response:
            health=json.load(response)
        if health.get('ok') is True and health.get('host')=='Nova':
            print('Existing V6 Nova service verified healthy.')
            break
    except Exception:
        pass
    time.sleep(1)
else:
    raise SystemExit('Nova health check failed; rolling back both components.')
PY
installed=no
echo 'Combined V7 Media Center + V6 native Nova installation completed.'
echo "Paired backup directory: $NOVA_BACKUP"
echo "Previous Media Center archive: $MEDIA_BACKUP"
echo 'Reopen Media Center. Test local music, Nova voice, 3D visualizer, and BCN listener audio on another device.'
echo 'This is a V7 preview, not a physically GPU-verified stable release.'
