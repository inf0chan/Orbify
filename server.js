const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const ITUNES_API = 'https://itunes.apple.com';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── iTunes Search (30-second previews, no API key needed) ──────────────────
// iTunes provides a free 30s audio preview URL per track via previewUrl.
// We normalize each result into the app's track shape.
async function searchITunes(query, limit) {
  const url =
    `${ITUNES_API}/search?term=${encodeURIComponent(query)}` +
    `&media=music&entity=song&limit=${limit}&country=US`;

  const r = await fetch(url, { headers: { 'User-Agent': 'Orbify/1.0' } });
  if (!r.ok) throw new Error(`iTunes responded ${r.status}`);
  const data = await r.json();

  return (data.results || [])
    .filter(i => i.previewUrl)
    .map(item => ({
      id:          `it__${item.trackId}`,
      title:       item.trackName || 'Unknown',
      artist:      item.artistName || 'Unknown',
      album:       item.collectionName || '',
      artwork:     (item.artworkUrl100 || '').replace('100x100bb', '600x600bb') || null,
      artworkSmall:item.artworkUrl100 || null,
      previewUrl:  item.previewUrl,
      duration:    Math.round((item.trackTimeMillis || 30000) / 1000),
      durationMs:  item.trackTimeMillis || 30000,
      genre:       item.primaryGenreName || 'Music',
      year:        item.releaseDate ? new Date(item.releaseDate).getFullYear() : null,
      streamType:  'itunes',
    }));
}

// ─── Search API (with lightweight cache) ────────────────────────────────────
const searchCache = new Map();  // normalized query -> { tracks, total, ts }
const CACHE_TTL   = 5 * 60 * 1000; // 5 minutes

function cacheKey(q, n) { return `${q.toLowerCase().trim()}|${n}`; }

app.get('/api/search', async (req, res) => {
  const { q, limit = 12 } = req.query;
  if (!q || !q.trim()) return res.status(400).json({ error: 'Query required' });

  const n    = Math.min(20, Math.max(1, Number(limit) || 12));
  const key  = cacheKey(q, n);
  const hit  = searchCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    return res.json({ tracks: hit.tracks, total: hit.total, source: 'itunes' });
  }

  try {
    const tracks = await searchITunes(q.trim(), n);
    searchCache.set(key, { tracks, total: tracks.length, ts: Date.now() });
    return res.json({ tracks, total: tracks.length, source: 'itunes' });
  } catch (err) {
    console.error('[iTunes search error]', err.message);
    return res.status(500).json({ error: 'Search failed. Please try again.' });
  }
});

// ─── Audio Proxy ────────────────────────────────────────────────────────────
// iTunes previews are piped through this endpoint so the Web Audio analyser
// gets CORS-clean audio. Range requests are forwarded so seeking works.
function isAllowedAudioHost(url) {
  try {
    const host = new URL(url).hostname;
    return host.includes('mzstatic.com') || host.includes('itunes.apple.com');
  } catch { return false; }
}

app.get('/api/preview', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const decoded = decodeURIComponent(url);
  if (!isAllowedAudioHost(decoded)) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  try {
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    if (req.headers.range) headers['Range'] = req.headers.range;

    const upstream = await fetch(decoded, { headers });

    res.status(upstream.status);
    ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(h => {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    upstream.body.pipe(res);
  } catch (err) {
    console.error('[Proxy error]', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Could not stream audio' });
  }
});

// ─── Health ────────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', source: 'itunes', previewSeconds: 30 });
});

// ─── SPA ───────────────────────────────────────────────────────────────────
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Start (local only — Vercel runs the exported app) ────────────────────
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n🎵  Orbify → http://localhost:${PORT}`);
    console.log(`    Source: iTunes 30-second previews (no key needed)`);
    console.log(`    Press Ctrl+C to stop.\n`);
  });
}

module.exports = app;
