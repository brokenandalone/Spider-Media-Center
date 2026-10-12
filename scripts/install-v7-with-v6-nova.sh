#!/usr/bin/env bash
# One transaction: V7 Media Center archive + the existing V6 native Nova DJ.
# Must be run from the verified GitHub Actions release bundle, as the desktop user.
set -Eeuo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
NOVA_OS_COMMIT='d1bd73ccff3abc6a8f810d74bc2f0ca13b28f3f5'
NOVA_OS_REPO='brokenandalone/spider-narive-os'
NOVA_TARGET='/usr/local/lib/spider-os/media/ai-dj'
MEDIA_TARGET='/opt/spider-media-center/resources/app.asar'
[[ $# -eq 1 && ( "$1" == --install || "$1" == --diagnose ) ]] || { echo 'Usage: bash install-v7-with-v6-nova.sh --install | --diagnose' >&2; exit 2; }
# Read-only diagnostics. This mode never downloads, changes, restarts or installs anything.
if [[ "$1" == --diagnose ]]; then
  echo 'Nova user service:' 
  systemctl --user status spider-ai-dj.service --no-pager -l || true
  echo 'Native Nova unit command:'
  systemctl --user show -p ExecStart spider-ai-dj.service --no-pager || true
  echo 'Local port 9876 listener:'
  if command -v ss >/dev/null; then ss -ltnp '( sport = :9876 )' || true; fi
  echo 'Native Nova /health (without HTTP proxy):'
  python3 - <<'PY'
import json,urllib.request
try:
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('http://127.0.0.1:9876/health',timeout=4) as response:
        health=json.load(response)
    print(json.dumps({k:health.get(k) for k in ('ok','host','service','station','port')}))
except Exception as error:
    print(type(error).__name__+': '+str(error))
PY
  echo 'Last 35 Nova service log lines:'
  journalctl --user -u spider-ai-dj.service -n 35 --no-pager || true
  exit 0
fi
[[ "$EUID" -ne 0 ]] || { echo 'Run as the desktop user, not root (sudo is requested for protected files).' >&2; exit 1; }
command -v sudo >/dev/null && command -v curl >/dev/null && command -v python3 >/dev/null && command -v systemctl >/dev/null ||
 { echo 'Requires sudo, curl, python3 and systemctl.' >&2; exit 1; }
[[ -f "$NOVA_TARGET/service.py" && ! -L "$NOVA_TARGET/service.py" ]] ||
 { echo 'Native V6 Nova service does not exist on Spider OS. No changes made.' >&2; exit 1; }
[[ -f "$MEDIA_TARGET" && ! -L "$MEDIA_TARGET" ]] ||
 { echo 'Existing Media Center app is missing. No changes made.' >&2; exit 1; }
bash "$ROOT/install-v7-preview.sh" --check
# Running desktop user owns the user-level DJ unit.
systemctl --user cat spider-ai-dj.service >/dev/null 2>&1 ||
 { echo 'Existing spider-ai-dj.service not found. Run --diagnose before installing.' >&2; exit 1; }
UNIT_COMMAND="$(systemctl --user show -p ExecStart --value spider-ai-dj.service)"
[[ "$UNIT_COMMAND" == *"$NOVA_TARGET/service.py"* ]] ||
 { echo 'spider-ai-dj.service does not launch the expected native service.py. Run --diagnose before installing.' >&2; exit 1; }
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT
mkdir -p "$WORK/nova"
for filename in nova_host.py nova_voice.py service.py; do
  curl --fail --location --silent --show-error --retry 3 \
    "https://raw.githubusercontent.com/$NOVA_OS_REPO/$NOVA_OS_COMMIT/media/ai-dj/$filename" \
    -o "$WORK/nova/$filename"
  [[ -s "$WORK/nova/$filename" ]] || { echo "Nova download empty: $filename" >&2; exit 1; }
done
PYTHONPYCACHEPREFIX="$WORK/python-cache" python3 -m py_compile "$WORK/nova/"*.py
# Syntax validation alone missed a real HTTPMessage collision in Nova.
# Exercise the downloaded Handler over an ephemeral loopback port without
# touching the live 9876 server, disk backups, or any user services.
PYTHONPYCACHEPREFIX="$WORK/python-cache" python3 - "$WORK/nova" <<'PY'
import importlib,json,sys,threading,urllib.error,urllib.request
from http.server import ThreadingHTTPServer
sys.path.insert(0,sys.argv[1])
service=importlib.import_module('service')
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
with ThreadingHTTPServer(('127.0.0.1',0),service.Handler) as server:
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    try:
        url='http://127.0.0.1:'+str(server.server_port)
        with opener.open(url+'/health',timeout=4) as response:
            payload=json.load(response)
            if response.status!=200 or payload.get('ok') is not True or payload.get('host')!='Nova':
                raise RuntimeError('Nova HTTP /health returned invalid identity: '+repr(payload))
        with opener.open(url+'/dj/voices',timeout=4) as response:
            voice_profiles=json.load(response)
            if response.status!=200 or 'matilda' not in voice_profiles.get('voices', []):
                raise RuntimeError('Native Nova Australian voice profiles are not available')
        with opener.open(urllib.request.Request(url+'/health',method='OPTIONS'),timeout=4) as response:
            if response.status!=204:
                raise RuntimeError('Nova HTTP OPTIONS response was invalid')
        try:
            opener.open(urllib.request.Request(url+'/not-found',data=b'{}',method='POST'),timeout=4)
            raise RuntimeError('Nova HTTP unknown POST path returned success')
        except urllib.error.HTTPError as error:
            if error.code!=404 or json.load(error).get('error')!='not found':
                raise RuntimeError('Nova HTTP unknown POST response was invalid') from error
    finally:
        server.shutdown()
        thread.join(timeout=3)
print('Pinned Nova HTTP preflight passed: health, OPTIONS and JSON 404.')
PY
# Backups of both Nova files are prepared before any installation.
STORAGE="$HOME/Studio/Media/SpiderMediaCenter/v7/paired-backups"
mkdir -p -m700 -- "$STORAGE"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
NOVA_BACKUP="$STORAGE/nova-$STAMP"
mkdir -m700 -- "$NOVA_BACKUP"
sudo cp -a -- "$NOVA_TARGET/service.py" "$NOVA_BACKUP/service.py"
HAD_VOICE=no
if [[ -f "$NOVA_TARGET/nova_voice.py" && ! -L "$NOVA_TARGET/nova_voice.py" ]]; then
  HAD_VOICE=yes
  sudo cp -a -- "$NOVA_TARGET/nova_voice.py" "$NOVA_BACKUP/nova_voice.py"
fi
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
  local problems=0
  sudo install -m644 -- "$MEDIA_BACKUP" "$MEDIA_TARGET" || problems=1
  sudo install -m644 -- "$NOVA_BACKUP/service.py" "$NOVA_TARGET/service.py" || problems=1
  if [[ "$HAD_VOICE" == yes ]]; then
    sudo install -m644 -- "$NOVA_BACKUP/nova_voice.py" "$NOVA_TARGET/nova_voice.py" || problems=1
  else
    sudo rm -f -- "$NOVA_TARGET/nova_voice.py" || problems=1
  fi
  if [[ "$HAD_PERSONA" == yes ]]; then
    sudo install -m644 -- "$NOVA_BACKUP/nova_host.py" "$NOVA_TARGET/nova_host.py" || problems=1
  else
    sudo rm -f -- "$NOVA_TARGET/nova_host.py" || problems=1
  fi
  sudo cmp -s -- "$MEDIA_BACKUP" "$MEDIA_TARGET" || problems=1
  sudo cmp -s -- "$NOVA_BACKUP/service.py" "$NOVA_TARGET/service.py" || problems=1
  if [[ "$HAD_VOICE" == yes ]]; then
    sudo cmp -s -- "$NOVA_BACKUP/nova_voice.py" "$NOVA_TARGET/nova_voice.py" || problems=1
  else
    [[ ! -e "$NOVA_TARGET/nova_voice.py" ]] || problems=1
  fi
  if [[ "$HAD_PERSONA" == yes ]]; then
    sudo cmp -s -- "$NOVA_BACKUP/nova_host.py" "$NOVA_TARGET/nova_host.py" || problems=1
  else
    [[ ! -e "$NOVA_TARGET/nova_host.py" ]] || problems=1
  fi
  systemctl --user restart spider-ai-dj.service || problems=1
  if [[ "$problems" == 0 ]]; then
    echo 'Rollback files verified byte-for-byte; previous Nova service was restarted.' >&2
  else
    echo 'WARNING: Rollback requires manual inspection. Backups are preserved:' >&2
    echo "  Media Center: $MEDIA_BACKUP" >&2
    echo "  Nova: $NOVA_BACKUP" >&2
  fi
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
sudo install -m644 -- "$WORK/nova/nova_voice.py" "$NOVA_TARGET/nova_voice.py"
sudo install -m644 -- "$WORK/nova/service.py" "$NOVA_TARGET/service.py"
systemctl --user restart spider-ai-dj.service
if ! python3 - <<'PY'
import json,sys,time,urllib.request
# Local health should never be diverted by desktop HTTP_PROXY settings.
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
last='no response'
for attempt in range(16):
    try:
        with opener.open('http://127.0.0.1:9876/health',timeout=3) as response:
            health=json.load(response)
        if health.get('ok') is True and health.get('host')=='Nova':
            print('Existing V6 Nova service verified healthy after '+str(attempt+1)+' check(s).')
            break
        last="Health endpoint answered but did not identify Nova: "+str({
            k:health.get(k) for k in ('ok','host','service','port')})
    except Exception as error:
        last=type(error).__name__+': '+str(error)
    time.sleep(1)
else:
    print('Nova health check failed: '+last,file=sys.stderr)
    raise SystemExit(1)
PY
then
  echo 'Nova did not start or returned an unexpected identity. Collecting diagnostics before rollback:' >&2
  systemctl --user status spider-ai-dj.service --no-pager -l >&2 || true
  if command -v ss >/dev/null; then ss -ltnp '( sport = :9876 )' >&2 || true; fi
  journalctl --user -u spider-ai-dj.service -n 35 --no-pager >&2 || true
  exit 1
fi
installed=no
echo 'Combined V7 Media Center + native Nova Australian voices installation completed.'
echo "Paired backup directory: $NOVA_BACKUP"
echo "Previous Media Center archive: $MEDIA_BACKUP"
echo 'Reopen Media Center. Test local music, Nova voice, 3D visualizer, and BCN listener audio on another device.'
echo 'This is a V7 preview, not a physically GPU-verified stable release.'
