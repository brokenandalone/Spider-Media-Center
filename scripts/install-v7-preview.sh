#!/usr/bin/env bash
# Explicit V7 candidate installer. Does not modify the pinned V6/Nova installer.
set -Eeuo pipefail
umask 077
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
target=/opt/spider-media-center/resources/app.asar
backup_dir=/opt/spider-media-center/resources/v7-preview-backups
usage(){ echo "Usage: bash install-v7-preview.sh --check | sudo bash install-v7-preview.sh --install | sudo bash install-v7-preview.sh --rollback BACKUP_FILE" >&2; exit 2; }
[[ $# -ge 1 ]] || usage
mode="$1"
case "$mode" in
  --check) [[ $# -eq 1 ]] || usage ;;
  --install) [[ $# -eq 1 ]] || usage ;;
  --rollback) [[ $# -eq 2 ]] || usage ;;
  *) usage ;;
esac
cd "$root"
verify_bundle(){
  [[ -f app.asar && -f SHA256SUMS && -f build.json ]] || { echo 'Missing preview build files.' >&2; exit 1; }
  [[ ! -L app.asar && ! -L SHA256SUMS && ! -L build.json ]] || { echo 'Symlinked build input rejected.' >&2; exit 1; }
  sha256sum --strict -c SHA256SUMS
  python3 - <<'PY'
import hashlib,json
from pathlib import Path
m=json.loads(Path('build.json').read_text())
a=Path('app.asar').read_bytes()
if m.get('releaseTrack')!='v7-preview' or m.get('installedPlaybackVerified') is not False:
    raise SystemExit('Not a marked, unverified V7 preview build')
if m.get('archiveSha256')!=hashlib.sha256(a).hexdigest():
    raise SystemExit('Preview archive digest does not match build manifest')
if not str(m.get('sourceRevision','')).strip() or m.get('sourceRevision')=='unknown':
    raise SystemExit('Preview source revision is not pinned')
PY
}
check_target(){
  [[ -f "$target" && ! -L "$target" ]] || { echo "Missing or symlinked target: $target" >&2; exit 1; }
  [[ -d "${target%/*}" && ! -L "${target%/*}" ]] || { echo 'Symlinked resource directory rejected.' >&2; exit 1; }
  python3 - <<'PY'
from pathlib import Path
for proc in Path('/proc').glob('[0-9]*'):
    try:
        exe=(proc/'exe').resolve(strict=True)
        cmd=(proc/'cmdline').read_bytes().replace(b'\0',b' ').decode('utf8','replace')
    except (OSError,RuntimeError):
        continue
    if exe.is_relative_to('/opt/spider-media-center') or '/opt/spider-media-center/' in cmd:
        raise SystemExit('Close Spider Media Center completely before modifying app.asar')
PY
}
if [[ "$mode" == --check ]]; then
  verify_bundle
  echo 'V7 preview bundle integrity passed. This does not validate your GPU or install anything.'
  exit 0
fi
[[ $EUID -eq 0 ]] || { echo 'Root privileges required for installation/rollback.' >&2; exit 1; }
check_target
if [[ "$mode" == --rollback ]]; then
  backup="$2"
  [[ "$backup" == "$backup_dir"/app.asar.before-v7-* ]] || { echo 'Backup must be a V7 preview backup under the dedicated backup directory.' >&2; exit 1; }
  [[ -f "$backup" && ! -L "$backup" ]] || { echo 'Backup not found or symlinked.' >&2; exit 1; }
  mkdir -p -- "$backup_dir"
  temp="$(mktemp "${target%/*}/.v7-rollback.XXXXXXXX")"
  trap 'rm -f -- "$temp"' EXIT
  install -m644 -- "$backup" "$temp"
  cmp -s -- "$backup" "$temp" || { echo 'Rollback copy mismatch.' >&2; exit 1; }
  mv -f -- "$temp" "$target"
  echo "Rolled back to $backup"
  exit 0
fi
verify_bundle
[[ -d "$backup_dir" && -L "$backup_dir" ]] && { echo 'Symlinked backup directory rejected.' >&2; exit 1; }
mkdir -p -m700 -- "$backup_dir"
backup="$backup_dir/app.asar.before-v7-$(date -u +%Y%m%dT%H%M%SZ)-$$"
# Copy the old app first. The preview is never written until backup verifies.
cp -p -- "$target" "$backup"
cmp -s -- "$target" "$backup" || { echo 'Backup verification failed.' >&2; exit 1; }
temp="$(mktemp "${target%/*}/.v7-preview.XXXXXXXX")"
trap 'rm -f -- "$temp"' EXIT
install -m644 -- "$root/app.asar" "$temp"
cmp -s -- "$root/app.asar" "$temp" || { echo 'Preview copy mismatch.' >&2; exit 1; }
mv -f -- "$temp" "$target"
echo 'V7 PREVIEW INSTALLED. GPU, Nova and BCN still require hands-on testing.'
echo "Previous archive: $backup"
echo "To restore after closing the player: sudo bash '$root/install-v7-preview.sh' --rollback '$backup'"
