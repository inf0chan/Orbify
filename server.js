const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const path    = require('path');
const { spawn } = require('child_process');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── yt-dlp Setup ────────────────────────────────────────────────────────────
const BIN_DIR     = path.join(__dirname, 'bin');
const BIN_NAME    = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const BUNDLED_BIN = path.join(BIN_DIR, BIN_NAME); // downloaded at build time (scripts/download-yt-dlp.js)
const LEGACY_BIN  = path.join(__dirname, BIN_NAME); // older local setups

let YT_DLP_BIN = BUNDLED_BIN;
let ytDlpReady = false;

/** Run yt-dlp and return stdout */
function execYtDlp(args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const proc   = spawn(YT_DLP_BIN, args, { windowsHide: true });

    proc.stdout.on('data', d => chunks.push(d));
    proc.stderr.on('data', () => {}); // suppress verbose output

    let timedOut = false;
    const timer  = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGKILL'); } catch {}
      reject(new Error('yt-dlp timeout'));
    }, timeoutMs);

    proc.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return;
      const out = Buffer.concat(chunks).toString('utf-8').trim();
      if (out) resolve(out);
      else     reject(new Error(`yt-dlp exit ${code}`));
    });

    proc.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

async function initYtDlp() {
  // 1. Bundled binary downloaded during build (Render/Railway)
  if (fs.existsSync(BUNDLED_BIN)) {
    YT_DLP_BIN = BUNDLED_BIN;
    try {
      await execYtDlp(['--version'], 15000);
      ytDlpReady = true;
      console.log('✅ yt-dlp found (bundled) — full songs enabled');
      return;
    } catch (err) {
      console.error('Bundled yt-dlp execution failed:', err.message);
    }
  }

  // 2. System yt-dlp
  try {
    YT_DLP_BIN = 'yt-dlp';
    await execYtDlp(['--version'], 15000);
    ytDlpReady = true;
    console.log('✅ yt-dlp found in PATH — full songs enabled');
    return;
  } catch {}

  // 3. Legacy yt-dlp binary in project root (previously downloaded)
  if (fs.existsSync(LEGACY_BIN)) {
    YT_DLP_BIN = LEGACY_BIN;
    try {
      await execYtDlp(['--version'], 15000);
      ytDlpReady = true;
      console.log('✅ yt-dlp found locally — full songs enabled');
      return;
    } catch (err) {
      console.error('Local yt-dlp execution failed:', err.message);
    }
  }

  // 4. Auto-download via yt-dlp-wrap (last resort, needs a writable fs)
  try {
    // yt-dlp-wrap exports vary by version; handle both CJS and ESM-compat
    let YTDlpWrap;
    try { YTDlpWrap = require('yt-dlp-wrap').default; } catch { YTDlpWrap = require('yt-dlp-wrap'); }

    console.log('⬇  Downloading yt-dlp binary (one-time, ~10 MB)…');
    await YTDlpWrap.downloadFromGithub(BUNDLED_BIN);
    YT_DLP_BIN = BUNDLED_BIN;
    await execYtDlp(['--version'], 4000);
    ytDlpReady = true;
    console.log('✅ yt-dlp downloaded — full songs enabled');
  } catch (e) {
    console.warn('⚠  yt-dlp unavailable — falling back to 30-second iTunes previews');
    console.warn('   To enable full songs, install yt-dlp: https://github.com/yt-dlp/yt-dlp');
  }
}

// ─── Search API ──────────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const { q, limit = 12 } = req.query;
  if (!q || !q.trim()) return res.status(400).json({ error: 'Query required' });

  const n = Math.min(20, Math.max(1, Number(limit) || 12));

  try {
    if (ytDlpReady) {
      // Start iTunes as a backup while we wait for YouTube (full songs).
      const itunesPromise = searchITunes(q.trim(), n).catch(() => null);

      try {
        const r = await searchYouTube(q.trim(), n);
        if (r.tracks && r.tracks.length > 0) {
          return res.json({ ...r, source: 'youtube' });
        }
        console.warn('[Search] YouTube returned no results');
      } catch (err) {
        console.error('[YouTube search error]', err.message);
      }

      // Fallback: iTunes previews (30s) so the user still gets something.
      const itunes = await itunesPromise;
      if (itunes && itunes.tracks && itunes.tracks.length > 0) {
        return res.json({ ...itunes, source: 'itunes', fallback: true });
      }
      throw new Error('No search source responded');
    }

    // iTunes-only fallback when yt-dlp isn't available
    const r = await searchITunes(q.trim(), n);
    return res.json({ ...r, source: 'itunes', fallback: true });
  } catch (err) {
    console.error('[Search error]', err.message);
    res.status(500).json({ error: 'Search failed. Please try again.' });
  }
});

async function searchYouTube(q, limit) {
  const raw = await execYtDlp([
    `ytsearch${limit}:${q}`,
    '--dump-json',
    '--flat-playlist',
    '--no-warnings',
    '--ignore-errors',
    '--extractor-args', 'youtube:skip=dash,hls',
  ], 30000);

  const tracks = raw.split('\n')
    .filter(l => l.trim().startsWith('{'))
    .map(line => {
      try {
        const item = JSON.parse(line);
        const parsed = parseVideoTitle(item.title || '');
        return {
          id:          item.id,
          videoId:     item.id,
          title:       parsed.title,
          artist:      parsed.artist || item.uploader || item.channel || 'Unknown',
          album:       '',
          artwork:     `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
          artworkSmall:`https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
          duration:    item.duration || 0,
          durationMs:  (item.duration || 0) * 1000,
          genre:       'Music',
          year:        item.upload_date ? parseInt(item.upload_date.slice(0, 4)) : null,
          streamType:  'youtube',
        };
      } catch { return null; }
    })
    .filter(Boolean);

  return { tracks, total: tracks.length };
}

async function searchITunes(q, limit) {
  const url  = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=${limit}&country=US`;
  const r    = await fetch(url, { headers: { 'User-Agent': 'Orbify/1.0' } });
  const data = await r.json();

  const tracks = (data.results || [])
    .filter(i => i.previewUrl)
    .map(item => ({
      id:          item.trackId,
      title:       item.trackName,
      artist:      item.artistName,
      album:       item.collectionName,
      artwork:     item.artworkUrl100?.replace('100x100bb', '600x600bb') || null,
      artworkSmall:item.artworkUrl100 || null,
      previewUrl:  item.previewUrl,
      duration:    Math.round((item.trackTimeMillis || 30000) / 1000),
      durationMs:  item.trackTimeMillis || 30000,
      genre:       item.primaryGenreName || 'Music',
      year:        item.releaseDate ? new Date(item.releaseDate).getFullYear() : null,
      streamType:  'itunes',
    }));

  return { tracks, total: tracks.length };
}

/** Parse "Artist - Title (Official Audio)" style YouTube titles */
function parseVideoTitle(title) {
  // Remove common suffixes
  const cleaned = title
    .replace(/\s*[\(\[](Official\s*(Video|Audio|Music\s*Video|Lyric\s*Video)|HD|HQ|4K|lyrics?|official)[\)\]]/gi, '')
    .replace(/\s*(Official\s*(Video|Audio|Music\s*Video|Lyric\s*Video))\s*$/gi, '')
    .trim();

  const dashMatch = cleaned.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    return { artist: dashMatch[1].trim(), title: dashMatch[2].trim() };
  }
  return { artist: 'Unknown', title: cleaned };
}

// ─── YouTube Audio Stream (proxy with range support) ─────────────────────────
const streamCache = new Map(); // videoId → { url, expires }

async function resolveStreamUrl(videoId) {
  const cached = streamCache.get(videoId);
  if (cached && cached.expires > Date.now()) return cached.url;

  const raw = await execYtDlp([
    `https://www.youtube.com/watch?v=${videoId}`,
    '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
    '--get-url',
    '--no-warnings',
    '--no-playlist',
  ], 30000);

  const url = raw.split('\n')[0].trim();
  streamCache.set(videoId, { url, expires: Date.now() + 2 * 60 * 60 * 1000 }); // 2h
  return url;
}

app.get('/api/stream/:videoId', async (req, res) => {
  if (!ytDlpReady) {
    return res.status(503).json({ error: 'yt-dlp not available' });
  }

  try {
    const url = await resolveStreamUrl(req.params.videoId);

    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (req.headers.range) headers['Range'] = req.headers.range;

    const upstream = await fetch(url, { headers });

    res.status(upstream.status);
    ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(h => {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    upstream.body.pipe(res);
  } catch (err) {
    console.error('[Stream error]', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Could not stream audio' });
  }
});

// ─── iTunes Preview Proxy ─────────────────────────────────────────────────────
app.get('/api/preview', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const decoded = decodeURIComponent(url);
  if (!decoded.includes('mzstatic.com') && !decoded.includes('itunes.apple.com')) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  try {
    const r = await fetch(decoded);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    r.body.pipe(res);
  } catch {
    res.status(500).json({ error: 'Proxy failed' });
  }
});

// ─── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', ytDlpReady, ytDlpBin: YT_DLP_BIN });
});

// ─── SPA ──────────────────────────────────────────────────────────────────────
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Start ───────────────────────────────────────────────────────────────────
// Bind the port immediately — don't block on yt-dlp setup.
app.listen(PORT, () => {
  console.log(`\n🎵  Orbify → http://localhost:${PORT}`);
  console.log(`    Full songs: ${ytDlpReady ? '✅ YouTube (yt-dlp)' : '⚠️  30s previews (iTunes)'}`);
  console.log(`    Press Ctrl+C to stop.\n`);

  // Auto-open the browser on Windows (local dev only — set OPEN_BROWSER=1)
  if (process.env.OPEN_BROWSER === '1' && process.platform === 'win32') {
    try { require('child_process').exec(`start "" http://localhost:${PORT}`); } catch {}
  }
});

// yt-dlp init continues in the background and upgrades to full songs when ready.
initYtDlp().then(() => {
  console.log(`    [init] yt-dlp ready → ${ytDlpReady ? 'full YouTube songs ✅' : 'iTunes previews only (30s)'}\n`);
});
