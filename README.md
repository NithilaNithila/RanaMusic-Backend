# music-backend

Express + MongoDB backend that proxies Jamendo (search/catalog data) and owns
the app's own user data (accounts, playlists, favorites, play history).

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
JAMENDO_CLIENT_ID=your_jamendo_client_id
JAMENDO_API_BASE=https://api.jamendo.com/v3.0
CLIENT_URL=http://localhost:5173
```

Get a free `JAMENDO_CLIENT_ID` at https://devportal.jamendo.com/.

## API overview

All routes are mounted under `/api`.

### Auth
- `POST /api/auth/register` — { username, email, password }
- `POST /api/auth/login` — { email, password }
- `GET  /api/auth/me` — requires Bearer token

### Catalog (public, proxied + cached from Jamendo)
- `GET /api/tracks/search?q=...`
- `GET /api/tracks/popular`
- `GET /api/tracks/:id`
- `GET /api/albums/search?q=...`
- `GET /api/albums/:id`
- `GET /api/albums/:id/tracks`
- `GET /api/artists/search?q=...`
- `GET /api/artists/:id`
- `GET /api/artists/:id/albums`
- `GET /api/artists/:id/tracks`

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

- All Jamendo calls funnel through `services/jamendo.service.js`, which
  keeps your `client_id` server-side and caches responses in-memory via
  `services/cache.service.js` (10 min TTL) to reduce Jamendo API quota usage.
- Send `Authorization: Bearer <token>` on protected routes; token is
  returned from `/api/auth/register` and `/api/auth/login`.
- The Jamendo `audio` field on each track is already a direct, playable
  URL — point your `<audio>` tag at it directly from the frontend instead
  of proxying audio bytes through this server.
