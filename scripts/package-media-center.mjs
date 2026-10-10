import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createPackage, extractFile, listPackage } from '@electron/asar';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(root, 'release'));
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'spider-media-build-'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const runtime = ['main.cjs', 'preload.cjs', 'renderer.js', 'renderer.audio.js',
  'renderer.bridge.js', 'network-directory.cjs', 'media-compatibility.cjs', 'nova-service.cjs', 'bcn-desk.cjs', 'bcn-listener-intake.cjs', 'radio-telemetry.cjs', 'radio-recovery.cjs',
  'player.html', 'offline.html', 'styles.css'];
try {
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(path.join(stage, 'electron'));
  for (const name of runtime) fs.copyFileSync(path.join(root, 'electron', name), path.join(stage, 'electron', name));
  fs.cpSync(path.join(root, 'dist'), path.join(stage, 'dist'), {
    recursive: true, filter: source => !path.basename(source).includes('.before-')
  });
  fs.mkdirSync(path.join(stage, 'assets'));
  fs.copyFileSync(path.join(root, 'assets/icon-512.png'), path.join(stage, 'assets/icon-512.png'));
  for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(root, name), path.join(stage, name));
  execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit' });
  // ASAR alone cannot run native addons or binaries; this runtime has neither.
  const walk = folder => fs.readdirSync(folder, { withFileTypes: true }).flatMap(e => {
    const p = path.join(folder, e.name);
    return e.isDirectory() ? walk(p) : e.isFile() ? [p] : [];
  });
  if (walk(stage).some(p => p.endsWith('.node'))) throw new Error('Native addons require a separate unpacked release.');
  const archive = path.join(output, 'app.asar');
  await createPackage(stage, archive);
  for (const file of walk(stage)) {
    const name = path.relative(stage, file).split(path.sep).join('/');
    if (hash(extractFile(archive, name)) !== hash(fs.readFileSync(file))) throw new Error('Archive mismatch: ' + name);
  }
  for (const name of [...runtime.map(n => 'electron/' + n), 'dist/index.html', 'dist/media-center-upgrades.js', 'assets/icon-512.png', 'package.json']) {
    if (hash(extractFile(archive, name)) !== hash(fs.readFileSync(path.join(stage, name)))) throw new Error('Archive mismatch: ' + name);
  }
  const entries = listPackage(archive);
  for (const name of ['qrcode', 'music-metadata', 'react', 'react-dom']) {
    if (!entries.includes('/node_modules/' + name + '/package.json')) throw new Error('Missing runtime dependency: ' + name);
  }
  if (entries.some(n => n.includes('.before-') || n.includes('/@electron/asar/'))) throw new Error('Development files entered the archive.');
  fs.copyFileSync(path.join(root, 'scripts/install-media-center.sh'), path.join(output, 'install-media-center.sh'));
  fs.copyFileSync(path.join(root, 'docs/INSTALL-BUILD.md'), path.join(output, 'README.md'));
  let revision = process.env.SPIDER_BUILD_REVISION || process.env.GITHUB_SHA || 'unknown';
  if (revision === 'unknown') {
    try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch {}
  }
  fs.writeFileSync(path.join(output, 'build.json'), JSON.stringify({ version: '1.0.0', sourceRevision: revision, node: process.version, archiveSha256: hash(fs.readFileSync(archive)), archiveEntries: entries.length, installedPlaybackVerified: false }, null, 2) + '\n');
  const deliverables = ['app.asar', 'install-media-center.sh', 'README.md', 'build.json'];
  fs.writeFileSync(path.join(output, 'SHA256SUMS'), deliverables.map(n => hash(fs.readFileSync(path.join(output, n))) + '  ' + n + '\n').join(''));
  console.log(`Verified Media Center ASAR (${entries.length} entries): ${archive}`);
} finally { fs.rmSync(stage, { recursive: true, force: true }); }
