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
