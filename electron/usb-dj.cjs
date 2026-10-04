const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function candidateRoots() {
  const user = process.env.USER || process.env.USERNAME || os.userInfo().username;
  const override = String(process.env.SPIDER_DJ_HOME || '').trim();
  const roots = [];

  if (override) roots.push(override);

  for (const base of [
    path.join('/media', user),
    path.join('/run/media', user)
  ]) {
    try {
      for (const name of fs.readdirSync(base)) {
        roots.push(path.join(base, name, 'SPIDER_DJ'));
      }
    } catch { }
  }

  return [...new Set(roots)];
}

function readManifest(directory) {
  const manifestPath = path.join(directory, 'spider-dj.json');
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return {
      directory,
      manifestPath,
      manifest
    };
  } catch (error) {
    return {
      directory,
      manifestPath,
      manifest: null,
      error: error.message
    };
  }
}

function findPortableDj() {
  for (const directory of candidateRoots()) {
    const result = readManifest(directory);
    if (result) {
      return {
        available: Boolean(result.manifest),
        ...result
      };
    }
  }

  return {
    available: false,
    directory: '',
    manifestPath: '',
    manifest: null
  };
}

module.exports = {
  candidateRoots,
  findPortableDj
};
