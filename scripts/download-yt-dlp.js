/**
 * download-yt-dlp.js
 *
 * Downloads the correct yt-dlp binary for the current platform into ./bin.
 * Runs automatically as a `postinstall` step so that Render/Railway bake the
 * binary into the deploy image (fast cold starts, no runtime download).
 *
 * Skips the download if a binary already exists in ./bin or at the project
 * root (legacy local setup), so local dev on Windows isn't forced to re-download.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');

const ROOT    = path.join(__dirname, '..');
const BIN_DIR = path.join(ROOT, 'bin');

function binaryName() {
  if (process.platform === 'win32') return 'yt-dlp.exe';
  return 'yt-dlp';
}

function assetForPlatform() {
  const p   = process.platform;
  const arch = process.arch;

  if (p === 'win32') return arch === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe';
  if (p === 'darwin') return 'yt-dlp_macos';
  if (p === 'linux') {
    if (arch === 'arm64') return 'yt-dlp_linux_aarch64';
    if (arch === 'x64')   return 'yt-dlp';
    return 'yt-dlp_linux';
  }
  return 'yt-dlp_linux';
}

function getLatestVersion() {
  return new Promise((resolve, reject) => {
    https.get('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
      headers: { 'User-Agent': 'orbify', Accept: 'application/vnd.github+json' },
    }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`GitHub API responded with ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(body).tag_name);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'orbify' } }, res => {
      // GitHub release downloads redirect to a signed object store URL.
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', err => { file.destroy(); reject(err); });
      res.on('error', err => { file.destroy(); reject(err); });
    }).on('error', reject);
  });
}

(async () => {
  const dest   = path.join(BIN_DIR, binaryName());
  const legacy = path.join(ROOT, binaryName());

  if (fs.existsSync(dest) || fs.existsSync(legacy)) {
    console.log('[yt-dlp] binary already present — skipping download');
    return;
  }

  try {
    const version = process.env.YTDLP_VERSION || await getLatestVersion();
    const asset   = assetForPlatform();
    const url     = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${asset}`;

    fs.mkdirSync(BIN_DIR, { recursive: true });
    console.log(`[yt-dlp] downloading ${asset} (${version}) → ${dest}`);
    await download(url, dest);

    if (process.platform !== 'win32') {
      fs.chmodSync(dest, 0o755);
    }
    console.log('[yt-dlp] ready');
  } catch (err) {
    // Non-fatal: the app falls back to 30-second iTunes previews if yt-dlp
    // is missing, so a download failure must NOT fail the whole build.
    console.warn(`[yt-dlp] download failed: ${err.message}`);
    console.warn('[yt-dlp] the app will run with iTunes previews only');
  }
})();
