'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname,'..','scripts','install-nova-bcn.sh'), 'utf8');

test('V6 source installer stages releases by verified manifest version', () => {
  assert.match(source, /RELEASE_VERSION="\$\(python3 - "\$WORK\/release\/build\.json"/);
  assert.match(source, /re\.fullmatch\(r'\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+'/);
  assert.match(source, /SpiderMediaCenter\/v\$RELEASE_VERSION\/installed-builds/);
  assert.doesNotMatch(source, /SpiderMediaCenter\/v1\.0\/installed-builds/);
});

test('native service restart and health failures roll back BOTH components', () => {
  assert.match(source, /ASAR_BACKUP="\$TARGET\.before-bcn-pair-/);
  assert.match(source, /restore_media_center\(\) \{/);
  assert.match(source, /restore_nova\(\) \{/);
  assert.match(source, /if ! sudo bash "\$SAVED\/install-media-center\.sh"; then\s+restore_media_center/);
  assert.match(source, /Native service restart failed, restoring both components/);
  assert.match(source, /Nova health check failed[\s\S]*?restore_nova\s+restore_media_center/);
  assert.match(source, /Native Nova source installation failed/);
});

test('backup names are unique even for installs performed during the same second', () => {
  assert.match(source, /NOVA_BACKUP="\$NOVA_TARGET\/service\.py\.before-bcn-\$\(date \+%Y%m%d-%H%M%S\)-\$\$"/);
  assert.match(source, /ASAR_BACKUP="\$TARGET\.before-bcn-pair-\$\(date \+%Y%m%d-%H%M%S\)-\$\$"/);
  assert.doesNotMatch(source, /service\.py\.before-bcn-\$\(date \+%Y%m%d-%H%M%S\)-\$"/);
});

test('one service remains, and no installer reboots or upgrades Spider OS itself', () => {
  assert.match(source, /systemctl --user restart spider-ai-dj\.service/);
  assert.doesNotMatch(source, /systemctl --user (enable|restart) (webbie|kali)/);
  assert.doesNotMatch(source, /\b(reboot|do-release-upgrade|dist-upgrade|full-upgrade)\b/);
  assert.match(source, /SOURCE_COMMIT='[a-f0-9]{40}'/);
  assert.match(source, /NOVA_OS_COMMIT='[a-f0-9]{40}'/);
});
