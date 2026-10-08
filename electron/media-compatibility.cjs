// Native FFmpeg decoding prepares a separate WebM copy for Spider's embedded
// deck. Originals remain untouched; no external player window is opened.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {fileURLToPath, pathToFileURL} = require('node:url');
const {spawn} = require('node:child_process');
const VIDEO_EXTENSIONS = new Set(['.mp4','.m4v','.mkv','.mov','.webm','.avi','.mpeg','.mpg','.wmv']);
const CACHE_LIMIT = 4 * 1024 ** 3;
class MediaCompatibility {
  constructor(cacheDir, options = {}) {
    this.cacheDir = cacheDir;
    this.spawn = options.spawn || spawn;
    this.ffmpeg = options.ffmpeg || 'ffmpeg';
    this.job = null;
  }
  async prepare(url, onProgress = () => {}) {
    if (this.job) throw new Error('Another movie is being prepared. Cancel it first.');
    let input;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'file:') throw new Error();
      input = fs.realpathSync(fileURLToPath(parsed));
    } catch { throw new Error('Compatibility preparation requires a local movie file.'); }
    const info = fs.statSync(input);
    if (!info.isFile() || !VIDEO_EXTENSIONS.has(path.extname(input).toLowerCase())) throw new Error('Choose a supported local movie file.');
    fs.mkdirSync(this.cacheDir, {recursive: true, mode: 0o700});
    const key = crypto.createHash('sha256').update(JSON.stringify([input, info.size, info.mtimeMs, 'vp8-opus-v1'])).digest('hex');
    const output = path.join(this.cacheDir, `${key}.webm`);
    if (fs.existsSync(output) && fs.statSync(output).size > 0) return {url: pathToFileURL(output).href, cached: true};
    const used = fs.readdirSync(this.cacheDir).filter(name => /^[a-f0-9]{64}\.webm$/.test(name)).reduce((bytes, name) => bytes + fs.statSync(path.join(this.cacheDir, name)).size, 0);
    if (used >= CACHE_LIMIT) throw new Error('The movie compatibility cache is full. Clear older cached copies before preparing another movie.');
    if (fs.statfsSync) {
      const disk = fs.statfsSync(this.cacheDir);
      if (disk.bavail * disk.bsize < 1024 ** 3) throw new Error('At least 1 GB of free disk space is needed to prepare a movie.');
    }
    const partial = `${output}.partial`;
    const args = ['-nostdin','-hide_banner','-loglevel','error','-y',
      '-protocol_whitelist','file,pipe','-i',input,'-map','0:v:0','-map','0:a:0?',
      '-vf',"scale='trunc(min(iw,1920)/2)*2':-2",'-c:v','libvpx','-b:v','2M','-crf','12',
      '-deadline','realtime','-cpu-used','6','-threads','2','-c:a','libopus','-b:a','128k','-ac','2',
      '-progress','pipe:1','-f','webm',partial];
    return new Promise((resolve, reject) => {
      let errors = '', progress = '', reason = '', finished = false;
      const child = this.spawn(this.ffmpeg, args, {shell: false, windowsHide: true, stdio: ['ignore','pipe','pipe']});
      const job = {child, cancel: () => stop('Movie preparation cancelled.')};
      this.job = job;
      const stop = message => {
        reason ||= message;
        child.kill('SIGTERM');
        forceKill ||= setTimeout(() => child.kill('SIGKILL'), 3000);
        forceKill.unref?.();
      };
      let forceKill;
      const timer = setInterval(() => {
        try {
          if (fs.existsSync(partial) && used + fs.statSync(partial).size > CACHE_LIMIT) stop('Movie compatibility cache limit reached.');
          if (fs.statfsSync) {
            const disk = fs.statfsSync(this.cacheDir);
            if (disk.bavail * disk.bsize < 256 * 1024 ** 2) stop('Movie preparation stopped because disk space is low.');
          }
        } catch (error) { stop(error.message); }
      }, 1000);
      const timeout = setTimeout(() => stop('Movie preparation timed out.'), 2 * 60 * 60 * 1000);
      const finish = (error) => {
        if (finished) return;
        finished = true;
        clearInterval(timer); clearTimeout(timeout); clearTimeout(forceKill);
        if (this.job === job) this.job = null;
        if (error) { fs.rmSync(partial, {force: true}); reject(error); return; }
        try {
          if (!fs.existsSync(partial) || fs.statSync(partial).size === 0) throw new Error('The movie decoder produced no video.');
          if (used + fs.statSync(partial).size > CACHE_LIMIT) throw new Error('Movie compatibility cache limit reached.');
          fs.renameSync(partial, output);
          resolve({url: pathToFileURL(output).href, cached: false});
        } catch (failure) { fs.rmSync(partial, {force: true}); reject(failure); }
      };
      child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
      child.stdout.on('data', chunk => {
        progress += chunk;
        const lines = progress.split('\n'); progress = lines.pop();
        for (const line of lines) if (line.startsWith('out_time_us=')) {
          try { onProgress({seconds: Math.max(0, Number(line.split('=')[1]) / 1000000)}); } catch {}
        }
      });
      child.once('error', error => finish(new Error(error.code === 'ENOENT' ? 'FFmpeg is unavailable. Enable the installed Ubuntu Studio FFmpeg tools and try again.' : error.message)));
      child.once('close', code => finish(reason ? new Error(reason) : code === 0 ? null : new Error(errors.trim() || 'The native movie decoder could not prepare this file.')));
    });
  }
  cancel() { if (!this.job) return false; this.job.cancel(); return true; }
}
module.exports = {MediaCompatibility};
