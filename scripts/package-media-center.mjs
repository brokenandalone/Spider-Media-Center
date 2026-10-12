import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createPackage, extractFile, listPackage } from '@electron/asar';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const releaseVersion = packageInfo.version || '1.0.0';
const output = path.resolve(process.argv[2] || path.join(root, 'release'));
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'spider-media-build-'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const runtime = ['main.cjs', 'preload.cjs', 'renderer.js', 'renderer.audio.js',
  'renderer.bridge.js', 'network-directory.cjs', 'media-compatibility.cjs', 'nova-service.cjs', 'bcn-desk.cjs', 'bcn-prepare-queue.cjs', 'bcn-listener-intake.cjs', 'radio-telemetry.cjs', 'radio-recovery.cjs', 'radio-relay-probe.cjs',
  'player.html', 'offline.html', 'styles.css', 'music-library-audit.cjs'];
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
  for (const name of [...runtime.map(n => 'electron/' + n), 'dist/index.html', 'dist/media-center-upgrades.js', 'dist/queue-cleanup-core.js', 'dist/playlist-workshop-core.js', 'dist/playlist-workshop.js', 'dist/playlist-workshop.css', 'dist/visualizer-3d-shaders.js', 'dist/visualizer-performance.js', 'dist/visualizer-presets.js', 'dist/visualizer-3d.js', 'assets/icon-512.png', 'package.json']) {
    if (hash(extractFile(archive, name)) !== hash(fs.readFileSync(path.join(stage, name)))) throw new Error('Archive mismatch: ' + name);
  }
  const entries = listPackage(archive);
  for (const name of ['qrcode', 'music-metadata', 'react', 'react-dom']) {
    if (!entries.includes('/node_modules/' + name + '/package.json')) throw new Error('Missing runtime dependency: ' + name);
  }
  if (entries.some(n => n.includes('.before-') || n.includes('/@electron/asar/'))) throw new Error('Development files entered the archive.');
  fs.copyFileSync(path.join(root, 'scripts/install-media-center.sh'), path.join(output, 'install-media-center.sh'));
  fs.copyFileSync(path.join(root, 'scripts/install-v7-preview.sh'), path.join(output, 'install-v7-preview.sh'));
  fs.copyFileSync(path.join(root, 'scripts/install-v7-with-v6-nova.sh'), path.join(output, 'install-v7-with-v6-nova.sh'));
  fs.copyFileSync(path.join(root, 'docs/INSTALL-BUILD.md'), path.join(output, 'README.md'));
  let revision = process.env.SPIDER_BUILD_REVISION || process.env.GITHUB_SHA || 'unknown';
  if (revision === 'unknown') {
    try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch {}
  }
  fs.writeFileSync(path.join(output, 'build.json'), JSON.stringify({
    productName: packageInfo.name,
    displayName: 'Spider Media Center',
    version: releaseVersion,
    compatibilityBaseline: 'V6.0',
    majorUpgrade: true,
    releaseTrack: 'v7-preview',
    featureHighlights: [
      'radio recovery and relay restoration',
      'listener verification and delivery health monitoring',
      'public station reachability checks without automatic broadcast startup',
      'native movie compatibility conversion for unsupported local files',
      'AutoDJ continuity guard and show scheduling controls',
      'Nova voice integration and approved request handling',
      'Linux media-key and cloudflared integration',
      'repeatable installer and rollback packaging',
      'V7 WebGL visualizer with eight cinematic presets and 12 custom slots',
      'optional auto-scene rotation, cinema fullscreen and adaptive GPU diagnostics',
      'separate opt-in preview installer preserving V6 and native Nova',
      'bulk playlist selection, editing, import/export and BCN show rundown generator',
      'Australian neural Nova voices with Webbie Piper and Natasha/eSpeak recovery',
      'BCN cue rotation with a temporary Unknown Artist allowance for untagged music',
      'missing-media library cleanup with verified snapshots and no file deletion',
      'clear upcoming music without stopping current playback, purge blank cue rows, and disable stale AutoDJ refill'
    ],
    sourceRevision: revision,
    node: process.version,
    archiveSha256: hash(fs.readFileSync(archive)),
    archiveEntries: entries.length,
    installedPlaybackVerified: false
  }, null, 2) + '\n');
  const deliverables = ['app.asar', 'install-media-center.sh', 'install-v7-preview.sh', 'install-v7-with-v6-nova.sh', 'README.md', 'build.json'];
  fs.writeFileSync(path.join(output, 'SHA256SUMS'), deliverables.map(n => hash(fs.readFileSync(path.join(output, n))) + '  ' + n + '\n').join(''));
  console.log(`Verified Media Center ASAR (${entries.length} entries): ${archive}`);
} finally { fs.rmSync(stage, { recursive: true, force: true }); }
