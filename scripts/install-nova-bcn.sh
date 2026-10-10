#!/usr/bin/env bash
# One-run Spider Media Center / BCN Nova upgrade for an installed Spider OS.
set -Eeuo pipefail

REPO='brokenandalone/Spider-Media-Center'
SOURCE_COMMIT='abe58685aecbf14f3cc685e7540a5ac6d254073b'
CI_RUN_ID='38066548648'
ARTIFACT='Spider-Media-Center-Playback-Build'
NOVA_OS_REPO='brokenandalone/spider-narive-os'
NOVA_OS_COMMIT='980fccf98e4dfdfdb27b32a49c46158ca752a79c'
NOVA_TARGET='/usr/local/lib/spider-os/media/ai-dj'
TARGET='/opt/spider-media-center/resources/app.asar'
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT

fail() { printf 'Media Center installation stopped: %s\n' "$*" >&2; exit 1; }
printf '\nSpider OS · BCN / Nova combined installation\n'
[[ "$EUID" -ne 0 ]] || fail 'Run as your normal desktop user, not root. The installer will request sudo when needed.'
[[ -f "$TARGET" && ! -L "$TARGET" ]] || fail "Existing Media Center installation not found at $TARGET."
command -v python3 >/dev/null || fail 'python3 is required.'

mkdir -p "$WORK/release"
if command -v gh >/dev/null && gh auth status -h github.com >/dev/null 2>&1; then
  echo 'Retrieving the exact GitHub Actions release artifact...'
  if ! gh run download "$CI_RUN_ID" -R "$REPO" -n "$ARTIFACT" -D "$WORK/release"; then
    echo 'Artifact download did not succeed. Switching to a local source build.'
    rm -rf -- "$WORK/release"
    mkdir -p "$WORK/release"
  fi
fi

if [[ ! -s "$WORK/release/app.asar" ]]; then
  echo 'Building from the pinned, tested GitHub source commit.'
  command -v curl >/dev/null || fail 'curl is required to download the pinned source.'
  command -v tar >/dev/null || fail 'tar is required to extract the source.'
  command -v node >/dev/null || fail 'Node.js 22.12 or newer is required for the local fallback build.'
  command -v npm >/dev/null || fail 'npm is required for the local fallback build.'
  node -e 'let a=process.versions.node.split(".").map(Number);process.exit(a[0]>22||(a[0]===22&&a[1]>=12)?0:1)' ||
    fail "Node.js is too old: $(node --version). Use Node.js 22.12+ or a signed-in GitHub CLI to download the artifact."
  mkdir -p "$WORK/source"
  curl --fail --location --silent --show-error --retry 3 \
    "https://codeload.github.com/$REPO/tar.gz/$SOURCE_COMMIT" -o "$WORK/source.tar.gz"
  tar -xzf "$WORK/source.tar.gz" --strip-components=1 -C "$WORK/source"
  (
    cd "$WORK/source"
    npm ci --ignore-scripts --no-audit --no-fund
    npm run check
    npm test
    SPIDER_BUILD_REVISION="$SOURCE_COMMIT" npm run package:linux -- "$WORK/release"
  )
fi

for name in app.asar install-media-center.sh SHA256SUMS build.json; do
  [[ -s "$WORK/release/$name" ]] || fail "The release package is incomplete: $name."
done

# Check that the artifact really belongs to the verified Nova/BCN code.
python3 - "$WORK/release/build.json" "$SOURCE_COMMIT" "$WORK/release/app.asar" <<'PY'
import hashlib, json, pathlib, sys
meta = json.loads(pathlib.Path(sys.argv[1]).read_text())
expected = sys.argv[2]
archive = pathlib.Path(sys.argv[3])
if meta.get("sourceRevision") != expected:
    raise SystemExit("Build revision did not match the verified GitHub commit. No changes were installed.")
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
if digest != meta.get("archiveSha256"):
    raise SystemExit("Built archive digest did not match its build manifest. No changes were installed.")
print("Pinned commit and ASAR archive digest verified.")
PY

bash "$WORK/release/install-media-center.sh" --check

# Fetch the new native Nova personality and its existing service from a pinned
# Spider OS commit. This is ONE service, not a USB DJ or competing daemon.
[[ -f "$NOVA_TARGET/service.py" && ! -L "$NOVA_TARGET/service.py" ]] ||
  fail "The existing native Nova service is missing at $NOVA_TARGET/service.py; no changes were made."
command -v curl >/dev/null || fail 'curl is needed for the pinned native Nova service upgrade.'
mkdir -p "$WORK/nova"
for filename in nova_host.py service.py; do
  curl --fail --location --silent --show-error --retry 3 \
    "https://raw.githubusercontent.com/$NOVA_OS_REPO/$NOVA_OS_COMMIT/media/ai-dj/$filename" \
    -o "$WORK/nova/$filename"
  [[ -s "$WORK/nova/$filename" ]] || fail "Native Nova source is empty: $filename"
done
PYTHONPYCACHEPREFIX="$WORK/python-cache" python3 -m py_compile \
  "$WORK/nova/nova_host.py" "$WORK/nova/service.py"
echo 'Native Nova personality and service verified against pinned Spider OS commit.'

# Preserve a user-owned copy of the successful package alongside Studio.
SAVED="$HOME/Studio/Media/SpiderMediaCenter/v1.0/installed-builds/bcn-nova-$SOURCE_COMMIT"
mkdir -p "$SAVED"
cp -a -- "$WORK/release/." "$SAVED/"
printf 'Release files retained in: %s\n' "$SAVED"

echo 'Installing verified Media Center and upgrading the EXISTING Spider OS Nova service.'
sudo bash "$SAVED/install-media-center.sh"

NOVA_BACKUP="$NOVA_TARGET/service.py.before-bcn-$(date +%Y%m%d-%H%M%S)-$"
sudo cp -a -- "$NOVA_TARGET/service.py" "$NOVA_BACKUP"
if [[ -f "$NOVA_TARGET/nova_host.py" ]]; then
  sudo cp -a -- "$NOVA_TARGET/nova_host.py" "$NOVA_BACKUP.persona"
fi

# Keep both exact native sources in the user-owned package for future audit.
cp -a -- "$WORK/nova/service.py" "$WORK/nova/nova_host.py" "$SAVED/"
sudo install -m644 -- "$WORK/nova/nova_host.py" "$NOVA_TARGET/nova_host.py"
sudo install -m644 -- "$WORK/nova/service.py" "$NOVA_TARGET/service.py"
echo "Existing native Nova service backed up to: $NOVA_BACKUP"

if systemctl --user restart spider-ai-dj.service; then
  echo 'Restarted native Spider OS Nova user service.'
else
  echo 'Native service restart failed, restoring previous Python service files.'
  sudo cp -a -- "$NOVA_BACKUP" "$NOVA_TARGET/service.py"
  if [[ -f "$NOVA_BACKUP.persona" ]]; then
    sudo cp -a -- "$NOVA_BACKUP.persona" "$NOVA_TARGET/nova_host.py"
  else
    sudo rm -f -- "$NOVA_TARGET/nova_host.py"
  fi
  systemctl --user restart spider-ai-dj.service 2>/dev/null || true
  fail 'Nova service restart failed; its original sources have been restored. The Media Center app.asar backup was printed above.'
fi

if python3 - <<'PY'
import json, time, urllib.request
for attempt in range(5):
    try:
        with urllib.request.urlopen('http://127.0.0.1:9876/health', timeout=3) as response:
            status = json.load(response)
        if status.get('ok') is True and status.get('host') == 'Nova':
            print('Native Nova DJ: healthy, on-air name Nova; single Spider OS service.')
            break
    except Exception:
        pass
    time.sleep(1)
else:
    raise SystemExit('Nova health check did not confirm the on-air identity.')
PY
then
  echo 'Nova and BCN code installation completed.'
else
  echo 'Nova health check failed. Restoring the previous native DJ service.'
  sudo cp -a -- "$NOVA_BACKUP" "$NOVA_TARGET/service.py"
  if [[ -f "$NOVA_BACKUP.persona" ]]; then
    sudo cp -a -- "$NOVA_BACKUP.persona" "$NOVA_TARGET/nova_host.py"
  else
    sudo rm -f -- "$NOVA_TARGET/nova_host.py"
  fi
  systemctl --user restart spider-ai-dj.service 2>/dev/null || true
  fail "Nova health check failed, native service restored; the Media Center rollback command was printed above."
fi


cat <<'NEXT'

NEXT: Open Spider Media Center from The Web > Media.
1. In BCN Media, press "Check Nova DJ".
2. In Nova DJ Control, enable AI DJ. Set a 2-song break for testing.
3. Play at least two local tracks; confirm Nova speaks and music ducks.
4. Start a BCN broadcast using music you have rights to stream.
5. Open the public listener link on a second device and confirm Nova's voice is heard there.

The installer printed the exact Media Center rollback command and saved the previous native Nova service.
NEXT
