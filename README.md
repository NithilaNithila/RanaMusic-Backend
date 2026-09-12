# music-backend

Express + MongoDB backend that proxies Saavn/JioSaavn (search/catalog data) and
owns the app's own user data (accounts, playlists, favorites, play history).

## Setup

```bash
npm install
cp .env.example .env   # or edit .env directly
npm run dev             # nodemon, http://localhost:5000
```

## Environment variables (.env)

```
PORT=5000
MONGO_URI=mongodb://localhost:27017/musicdb
JWT_SECRET=your_jwt_secret
SAAVN_API_BASE=https://jiosavanwave.vercel.app/api
CLIENT_URL=http://localhost:5173
```

The catalog proxy calls `SAAVN_API_BASE` first and automatically falls back to
direct JioSaavn scraping if the proxy is rate-limited (429) or down (5xx).

## API overview

All routes are mounted under `/api`.

### Auth
- `POST /api/auth/register` — { username, email, password }
- `POST /api/auth/login` — { email, password }
- `GET  /api/auth/me` — requires Bearer token

### Catalog (public, proxied + cached from Saavn)
- `GET /api/tracks/search?q=...`
- `GET /api/tracks/popular`
- `GET /api/tracks/:id`
- `GET /api/albums`
- `GET /api/albums/search?q=...`
- `GET /api/albums/:id`
- `GET /api/albums/:id/tracks`
- `GET /api/artists`
- `GET /api/artists/search?q=...`
- `GET /api/artists/:id`
- `GET /api/artists/:id/tracks`
- `GET /api/artists/:id/albums`

### Saavn (public, direct passthrough with extra options)
- `GET /api/saavn/search?q=...` — tracks + albums + artists in one response
- `GET /api/saavn/search/songs?q=...`
- `GET /api/saavn/search/albums?q=...`
- `GET /api/saavn/search/artists?q=...`
- `GET /api/saavn/songs/:id`
- `GET /api/saavn/songs/:id/lyrics`
- `GET /api/saavn/albums/:id`
- `GET /api/saavn/albums/:id/tracks`
- `GET /api/saavn/artists/:id`
- `GET /api/saavn/artists/:id/songs`
- `GET /api/saavn/artists/:id/albums`

### Amazon (public, metadata via the third-party Amazon Music API)
- `GET /api/amazon/search?q=...&type=all|track|album|artist|playlist`
- `GET /api/amazon/tracks/:id`
- `GET /api/amazon/albums/:id`
- `GET /api/amazon/albums/:id/tracks`
- `GET /api/amazon/artists/:id`
- `GET /api/amazon/artists/:id/top-tracks`
- `GET /api/amazon/playlists/:id`
- `GET /api/amazon/playlists/:id/tracks`

**Playback** (session/queue contract against `AMAZON_API_BASE`):

- `POST /api/amazon/playback/sessions` — seed a queue from `{ playParams, limit }`
- `GET  /api/amazon/playback/sessions/active`
- `GET  /api/amazon/playback/sessions/:sid/current`
- `GET  /api/amazon/playback/sessions/:sid/next?limit=`
- `GET  /api/amazon/playback/sessions/:sid/previous?limit=`
- `GET  /api/amazon/playback/sessions/:sid/queue?limit=`
- `GET  /api/amazon/playback/sessions/:sid/entities/:ref`
- `POST /api/amazon/playback/sessions/:sid/queue/next` — `{ playParams }`
- `POST /api/amazon/playback/sessions/:sid/queue/last` — `{ playParams }`
- `PUT  /api/amazon/playback/sessions/:sid/loop` — `{ loopMode }`
- `PUT  /api/amazon/playback/sessions/:sid/shuffle` — `{ shuffleMode }`
- `POST /api/amazon/playback/event` — report `start`/`stop`

### Amazon (unofficial web scraper, no approval/cookies)
Real-world Amazon catalog + metadata without the closed-Beta API, by talking to
the public `music.amazon.com/config.json` and Amazon's internal skill endpoints.
Amazon itself only serves Widevine-DRM streams, so the skill responses carry no
audio URL; every row below is instead filled with playable audio through the same
Saavn resolver that `/api/search` uses, so tracks — and every song inside
albums/playlists/artist top-tracks — are streamable.

- `GET /api/amazon/web/status` — provider enabled + caveats
- `GET /api/amazon/web/search?q=...&type=all|track|album|artist|playlist&page=&next=`
  (`page >= 2` requires a `next` pagination token passed straight through)
- `GET /api/amazon/web/tracks/:id`
- `GET /api/amazon/web/albums/:id` (`?region=` hints a music.amazon.* domain, else races all)
- `GET /api/amazon/web/albums/:id/tracks`
- `GET /api/amazon/web/artists/:id`
- `GET /api/amazon/web/artists/:id/top-tracks?limit=`
- `GET /api/amazon/web/playlists/:id`
- `GET /api/amazon/web/playlists/:id/tracks`
- `GET /api/amazon/web/community-playlists/:id`
- `GET /api/amazon/web/community-playlists/:id/tracks`

Disable globally with `AMZN_WEB_ENABLED=false` (see `.env.example`).

### YouTube Music (streaming gap-fill, in-process yt-dlp)
Used only when Saavn has no full-length copy — Saavn is resolved first, so about
80% of plays never touch YouTube. No API key, no external proxy: the backend
spawns the `yt-dlp` binary that ships in `node_modules/yt-dlp-exec` (installed
during `npm install`; override with `YTDLP_BINARY`).

- `GET /api/ytmusic/songs/:id/stream` — pipes a music.youtube.com video's audio
  (two processes on first play — one `-J` info probe for content-type/duration,
  then `-o -` audio; from then on the info probe is cached for 10 min). Returns
  `audio/mp4` or `audio/webm`.

Errors are mapped: bot-checks → `403`, unavailable/private → `404`, throttling →
`429`/`502`, disabled/broken-circuit → `503`. A circuit breaker opens after
`YT_BREAKER_THRESHOLD` consecutive upstream failures (403/429/502/503) and stays
open for `YT_BREAKER_COOLDOWN` ms so recurring YouTube throttling can never take
the stream route down. Kill-switch: `YT_ENABLED=false`.

See `.env.example` for all `YT_*` options (`YT_COOKIES`, `YT_PROXY`,
`YT_PLAYER_CLIENT`, `YT_FORMAT`, timeouts).

### Playlists (requires auth)
- `GET    /api/playlists`
- `POST   /api/playlists`
- `GET    /api/playlists/:id`
- `PUT    /api/playlists/:id`
- `DELETE /api/playlists/:id`
- `POST   /api/playlists/:id/tracks`
- `DELETE /api/playlists/:id/tracks/:jamendoId`

### Favorites (requires auth)
- `GET    /api/favorites?itemType=track|album|artist`
- `POST   /api/favorites`
- `DELETE /api/favorites/:itemType/:jamendoId`

### User (requires auth)
- `PUT  /api/users/me`
- `GET  /api/users/me/history`
- `POST /api/users/me/history`

## Notes

- All Saavn calls funnel through `services/saavn.service.js`, which keeps your
  API base server-side and caches responses in-memory via
  `services/cache.service.js` (10 min TTL) to reduce upstream load.
- If the proxy returns 429/500/503, `services/saavn.service.js` transparently
  falls back to `services/jiosaavn.service.js` (direct JioSaavn API with
  DES-decrypted media URLs).
- Send `Authorization: Bearer <token>` on protected routes; token is
  returned from `/api/auth/register` and `/api/auth/login`.
- The Saavn `audio` field on each track is already a direct, playable URL —
  point your `<audio>` tag at it directly from the frontend instead of proxying
  audio bytes through this server.
- When Saavn only returns a 30s preview, `services/trackResolver.service.js`
  falls back to a `/api/ytmusic/songs/:id/stream` URL (full-length) before ever
  letting a 30s preview reach the client.
