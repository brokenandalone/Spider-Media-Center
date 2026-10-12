'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const combined=fs.readFileSync(path.join(root,'scripts/install-v7-with-v6-nova.sh'),'utf8');
const v6=fs.readFileSync(path.join(root,'scripts/install-nova-bcn.sh'),'utf8');
const pack=fs.readFileSync(path.join(root,'scripts/package-media-center.mjs'),'utf8');
const workflow=fs.readFileSync(path.join(root,'.github/workflows/validate.yml'),'utf8');
test('single combined installer bundles V7 preview and pinned existing V6 Nova',()=>{
 assert.match(combined,/install-v7-preview\.sh" --check/);
 assert.match(combined,/install-v7-preview\.sh" --install/);
 assert.match(combined,/NOVA_OS_COMMIT='b0099290f9618b47a22342b43ca25bb856852a9e'/);
 assert.match(combined,/systemctl --user restart spider-ai-dj\.service/);
 assert.match(combined,/for filename in nova_host\.py nova_voice\.py service\.py/);
 assert.match(combined,/\/dj\/voices/);
 assert.match(combined,/health\.get\('host'\)=='Nova'/);
 assert.doesNotMatch(combined,/apt-get|systemctl enable|curl.*latest/);
});
test('backup and rollback are paired, original V6 pin remains intact',()=>{
 assert.match(combined,/MEDIA_BACKUP=/);
 assert.match(combined,/NOVA_BACKUP=/);
 assert.match(combined,/HAD_VOICE=/);
 assert.match(combined,/NOVA_BACKUP\/nova_voice\.py/);
 assert.match(combined,/rollback\(\)/);
 assert.match(combined,/trap on_exit EXIT/);
 assert.match(combined,/sudo cmp -s/);
 assert.match(v6,/SOURCE_COMMIT='c8f95f74ecc93eb858801eb2025af8f151e5116e'/);
 assert.match(v6,/CI_RUN_ID='38127241699'/);
});
test('release checksum manifest and CI include combined installer',()=>{
 assert.match(pack,/install-v7-with-v6-nova\.sh/);
 assert.match(pack,/deliverables = \[[^\n]*install-v7-with-v6-nova\.sh/);
 assert.match(workflow,/bash -n scripts\/install-v7-with-v6-nova\.sh/);
 const check=spawnSync('bash',['-n',path.join(root,'scripts/install-v7-with-v6-nova.sh')],{encoding:'utf8'});
 assert.equal(check.status,0,check.stderr);
});

test('Nova recovery exposes read-only diagnostics and avoids proxying loopback',()=>{
 assert.match(combined,/--diagnose/);
 assert.match(combined,/ProxyHandler\(\{\}\)/);
 assert.match(combined,/journalctl --user -u spider-ai-dj\.service -n 35/);
 assert.match(combined,/UNIT_COMMAND/);
 assert.match(combined,/health\.get\('host'\)=='Nova'/);
 assert.match(combined,/sudo cmp -s -- "\$MEDIA_BACKUP" "\$MEDIA_TARGET"/);
 assert.match(combined,/Rollback files verified byte-for-byte/);
 assert.match(combined,/WARNING: Rollback requires manual inspection/);
 assert.match(combined,/for attempt in range\(16\)/);
});

test('corrected Nova is exercised through real HTTP before any backup or file replacement',()=>{
 const preflight=combined.indexOf("PYTHONPYCACHEPREFIX=\"$WORK/python-cache\" python3 - \"$WORK/nova\"");
 const backups=combined.indexOf('STORAGE="$HOME/Studio/Media/SpiderMediaCenter/v7/paired-backups"');
 assert.ok(preflight>0 && preflight<backups);
 assert.match(combined,/ThreadingHTTPServer\(\('127\.0\.0\.1',0\),service\.Handler\)/);
 assert.match(combined,/opener\.open\(url\+'\/health'/);
 assert.match(combined,/method='OPTIONS'/);
 assert.match(combined,/Nova HTTP preflight passed/);
 assert.match(combined,/NOVA_OS_COMMIT='b0099290f9618b47a22342b43ca25bb856852a9e'/);
 assert.doesNotMatch(combined,/NOVA_OS_COMMIT='980fccf98e4dfdfdb27b32a49c46158ca752a79c'/);
});
