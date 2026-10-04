const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');

function firstExisting(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate));
}

function resolveVlcPath() {
  const override = String(process.env.SPIDER_VLC || '').trim();
  if (override) return override;

  if (process.platform === 'win32') {
    return firstExisting([
      'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
      'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe'
    ]) || 'vlc.exe';
  }

  return firstExisting([
    '/usr/bin/vlc',
    '/usr/bin/cvlc',
    '/usr/local/bin/vlc',
    '/usr/local/bin/cvlc'
  ]) || 'vlc';
}

const VLC_PATH = resolveVlcPath();

function getVlcInfo() {
  try {
    const result = spawnSync(VLC_PATH, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    });

    const firstLine = String(result.stdout || result.stderr || '')
      .split(/\r?\n/)
      .find(Boolean) || '';

    return {
      available: result.status === 0 || Boolean(firstLine),
      path: VLC_PATH,
      version: firstLine.trim()
    };
  } catch (error) {
    return {
      available: false,
      path: VLC_PATH,
      version: '',
      error: error.message
    };
  }
}

function assertNetworkUrl(value) {
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:', 'rtsp:'].includes(url.protocol)) {
    throw new Error('VLC network playback supports HTTP, HTTPS and RTSP sources here.');
  }
  return url.href;
}

function playExternal(value, options = {}) {
  const url = assertNetworkUrl(value);
  const info = getVlcInfo();
  if (!info.available) throw new Error('VLC is not installed or could not be started.');

  const args = [
    '--no-video-title-show',
    '--no-playlist-enqueue'
  ];

  if (options.fullscreen) args.push('--fullscreen');
  if (options.startTime && Number(options.startTime) > 0) {
    args.push('--start-time', String(Number(options.startTime)));
  }

  args.push(url);

  const child = spawn(VLC_PATH, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();

  return {
    ok: true,
    backend: 'vlc',
    pid: child.pid,
    url
  };
}

module.exports = {
  VLC_PATH,
  resolveVlcPath,
  getVlcInfo,
  playExternal
};
