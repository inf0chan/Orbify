# 🎵 Orbify

A Spotify-style music player with a **3D spinning vinyl record** that reacts to every beat. Search any song, drop the needle, and watch the record speed up and pulse with the music — all powered by a Web Audio analyser and Three.js.

## ✨ Features

- **3D vinyl visualizer** — a procedurally generated record (grooves, glossy glint, red center label) with a working tonearm that lowers onto the grooves when playing and lifts when paused.
- **Audio-reactive** — the record spins faster with the bass, the tonearm bounces with the beat, and a pulsing light follows the music in real time.
- **Song title on the record** — the vinyl's center label is re-printed with the currently playing track.
- **Instant search** — debounced search through the iTunes Search API, no API key needed (30-second previews per track).
- **CORS-safe streaming** — a small proxy pipes audio previews so the Web Audio analyser can read frequency data cleanly, with range-request support for seeking.
- **Full player controls** — play/pause, next/previous, shuffle, repeat, seek, volume, mute, and like.
- **Liked & Recent lists** — persisted in `localStorage`.
- **Keyboard shortcuts** — `Space`, `→`, `←`, `/`, `M`, `L`, `Esc`.
- **Deployable to Vercel** — zero-config serverless deployment.

## 🚀 Getting Started

Requires **Node.js 18+**. No API keys or environment setup required.

```bash
# install dependencies
npm install

# development (auto-reload)
npm run dev

# start
npm start
```

Then open **http://localhost:3000**. That's it — no `.env` needed. A `.env.example` is included only as a placeholder.

> **Note:** Audio playback needs a user gesture in the browser (click a track), which is standard Web Audio API behavior.

## 🧱 Tech Stack

| Layer    | Technology                                                        |
| -------- | ----------------------------------------------------------------- |
| Frontend | Vanilla JS, Three.js (r128, CDN), Web Audio API                   |
| Backend  | Node.js, Express                                                  |
| Search   | iTunes Search API (30s previews)                                  |
| Deploy   | Vercel (`vercel.json`)                                            |

## 🔍 How It Works

1. **Search** — `GET /api/search?q=...&limit=12` queries iTunes, normalizes results into the app's track shape, and caches them for 5 minutes.
2. **Stream** — `GET /api/preview?url=...` proxies iTunes preview URLs (allow-listed against `*.mzstatic.com` and `*.itunes.apple.com`), forwards `Range` headers so seeking works, and sets CORS headers.
3. **Analyse** — the audio element feeds into an `AnalyserNode` which splits the frequency spectrum into bass / mid / high bands.
4. **Visualize** — the Three.js scene spins the record at `baseSpeed + bass × boost`, pulsing a light and bouncing the tonearm from the live audio metrics.

## 📁 Project Structure

```
orbify/
├── server.js            # Express server: search, audio proxy, SPA
├── vercel.json          # Vercel serverless config
├── package.json
└── public/
    ├── index.html       # UI shell
    ├── css/
    │   ├── style.css    # Spotify-style layout
    │   └── vinyl.css    # canvas / overlay styles
    └── js/
        ├── api.js       # API client (search, stream URLs)
        ├── player.js    # Web Audio engine + analyser
        ├── vinyl.js     # Three.js vinyl + tonearm visualizer
        ├── ui.js        # DOM rendering, drawers, toasts
        └── app.js       # Bootstrap, wiring, shortcuts
```

## 📡 API

| Endpoint      | Description                                                    |
| ------------- | -------------------------------------------------------------- |
| `GET /api/health` | `{ status: 'ok', source: 'itunes', previewSeconds: 30 }`    |
| `GET /api/search?q=&limit=` | Search tracks (default `limit=12`, max `20`)          |
| `GET /api/preview?url=` | Proxy an iTunes preview URL with CORS + range support    |

## ☁️ Deploying to Vercel

```bash
npm i -g vercel
vercel
```

The included `vercel.json` routes all requests to `server.js` as a serverless function — no extra configuration needed.

Made by Himanshu Bisht