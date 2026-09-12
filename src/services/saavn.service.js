const axios = require("axios");
const saavnConfig = require("../config/saavn");
const { httpAgent, httpsAgent } = require("../config/http");
const { logger } = require("./logger.service");
const { getCache, setCache, delCache, makeCacheKey } = require("./cache.service");
const { normalizeTrack, normalizeAlbum, normalizeArtist, normalizePlaylist, getImage } = require("./saavn.mappers");
const { sanitizePagination } = require("../utils/pagination");
const { retry } = require("../utils/retry");
const mapLimit = require("../utils/mapLimit");
const jiosaavn = require("./jiosaavn.service");

const client = axios.create({
  baseURL: saavnConfig.baseURL,
  timeout: 5000, // Reduced from 10s to 5s for faster failure
  httpAgent,
  httpsAgent,
});

class SaavnUnavailableError extends Error {
  constructor(status, endpoint) {
    super(`Saavn API ${status} on ${endpoint}`);
    this.name = "SaavnUnavailableError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

const saavnGet = async (endpoint, params = {}) => {
  const cacheKey = makeCacheKey(`saavn:${endpoint}`, params);
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const data = await retry(
    async () => {
      try {
        const { data } = await client.get(endpoint, { params });
        return data;
      } catch (err) {
        const status = err.response?.status;
        // Treat EVERY upstream failure the same way: unreachable (no response),
        // throttled (429), broken proxy (5xx), or a plain 4xx (the proxy often
        // returns 404 for a track the direct JioSaavn API still resolves). They
        // all funnel into SaavnUnavailableError so withFallback can retry via
        // the direct API instead of surfacing a raw 500/404.
        if (!err.response || (status >= 400 && status <= 599)) {
          logger.warn({ status: status || "unreachable", endpoint }, "Saavn API unavailable, falling back to direct JioSaavn");
          const upstream = new SaavnUnavailableError(status || 0, endpoint);
          // Carry a Retry-After hint (seconds -> ms) so the retry loop can
          // back off by the upstream's own recommendation when throttled.
          const wait = Number(err.response?.headers?.["retry-after"] || 0) * 1000;
          if (wait > 0) upstream.retryAfterMs = wait;
          throw upstream;
        }
        throw err;
      }
    },
    {
      retries: 2,
      baseMs: 400,
      maxTotalMs: 10000,
      shouldRetry: (err) => {
        if (err instanceof SaavnUnavailableError) {
          // 429 is throttling — transient, worth a retry (backs off by the
          // upstream's Retry-After when present).
          if (err.status === 429) return true;
          // Other 4xx are deterministic (the proxy resolved but refused) —
          // retrying is pure latency, so fall straight through to the direct
          // JioSaavn fallback.
          if (err.status >= 400 && err.status < 500) return false;
          // 5xx / network: a moment of upstream trouble — worth retrying.
          return true;
        }
        return true;
      },
    }
  );
  // Never cache broken payloads that arrived as 200 (e.g. { data: { error } }).
  if (data && (!data.data || !data.data.error)) {
    setCache(cacheKey, data);
  } else {
    delCache(cacheKey);
  }
  return data;
};

const withFallback = (proxyFn, directFn) => async (...args) => {
  try {
    return await proxyFn(...args);
  } catch (err) {
    if (err instanceof SaavnUnavailableError) {
      return directFn(...args);
    }
    throw err;
  }
};

const isValidEntity = (entity) =>
  Boolean(entity) && Boolean(entity.id) && Boolean(entity.name);

// Splits a comma-separated id list (from ?ids=...) into a bounded array.
const parseIdList = (ids, max = 20) =>
  String(ids || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);

// Ensures single-entity getters resolve to null (-> 404) when the upstream
// returns an empty object for an invalid id instead of a 404 status.
const validateEntity = (fn) => async (...args) => {
  const result = await fn(...args);
  return isValidEntity(result) ? result : null;
};

const searchTracks = withFallback(
  async (query, opts = {}) => {
    const { page, limit } = sanitizePagination(opts);
    const data = await saavnGet("/search/songs", { query, page, limit });
    const results = (data.data?.results || []).map(normalizeTrack);
    return { total: data.data?.total || 0, results };
  },
  jiosaavn.searchTracks
);

const searchAlbums = withFallback(
  async (query, opts = {}) => {
    const { page, limit } = sanitizePagination(opts);
    const data = await saavnGet("/search/albums", { query, page, limit });
    const results = (data.data?.results || []).map(normalizeAlbum);
    // The Saavn proxy sometimes returns 200 with broken payloads (artists
    // serialized as PowerShell strings, images as whitespace).  Detect this
    // by checking whether most results lack images and treat it as a failure
    // so withFallback retries against the direct JioSaavn API.
    if (results.length > 0) {
      const withImage = results.filter((r) => r.image).length;
      if (withImage === 0) {
        logger.warn(
          { query, page, total: results.length },
          "Proxy returned album results with no images, falling back to direct JioSaavn"
        );
        // Drop the cached broken payload so the next request retries the proxy
        // instead of getting served the poisoned copy forever.
        delCache(makeCacheKey("saavn:/search/albums", { query, page, limit }));
        throw new SaavnUnavailableError(0, "broken-album-data");
      }
    }
    return { total: data.data?.total || 0, results };
  },
  jiosaavn.searchAlbums
);

const searchArtists = withFallback(
  async (query, opts = {}) => {
    const { page, limit } = sanitizePagination(opts);
    const data = await saavnGet("/search/artists", { query, page, limit });
    const results = (data.data?.results || []).map(normalizeArtist);
    return { total: data.data?.total || 0, results };
  },
  jiosaavn.searchArtists
);

// Best-effort playlist search used to enrich covers. The direct JioSaavn
// fallback has no clean playlist-search endpoint, so failures just return
// an empty list (the caller keeps the provider placeholder).
const searchPlaylists = async (query, opts = {}) => {
  try {
    const { page, limit } = sanitizePagination(opts);
    const data = await saavnGet("/search/playlists", { query, page, limit });
    return { total: data.data?.total || 0, results: (data.data?.results || []).map(normalizePlaylist) };
  } catch (err) {
    logger.warn({ err: { message: err.message } }, "saavn searchPlaylists failed");
    return { total: 0, results: [] };
  }
};

const getTrackById = validateEntity(
  withFallback(
    async (id) => {
      const data = await saavnGet("/songs", { ids: id });
      const songs = data.data || [];
      return songs.length ? normalizeTrack(songs[0]) : null;
    },
    jiosaavn.getTrackById
  )
);

// Collection getter for GET /songs?ids=a,b,c. The proxy accepts a
// comma-separated list in one call; if it is unavailable, fall back to
// resolving each id through getTrackById (which itself falls back to
// direct JioSaavn).
const getTracks = withFallback(
  async (ids) => {
    const list = parseIdList(ids);
    if (!list.length) return { total: 0, results: [] };
    const data = await saavnGet("/songs", { ids: list.join(",") });
    const results = (data.data || []).filter(isValidEntity).map(normalizeTrack);
    return { total: results.length, results };
  },
  async (ids) => {
    const list = parseIdList(ids, 10);
    const found = (await mapLimit(list, 5, getTrackById)).filter(Boolean);
    return { total: found.length, results: found };
  }
);

// Similar-songs suggestions: GET /songs/{id}/suggestions
const getTrackSuggestions = async (id) => {
  const data = await saavnGet(`/songs/${id}/suggestions`);
  const results = (data.data || []).map(normalizeTrack);
  return { total: results.length, results };
};

const getAlbumById = validateEntity(
  withFallback(
    async (id) => {
      const data = await saavnGet("/albums", { id });
      return data?.data ? normalizeAlbum(data.data) : null;
    },
    jiosaavn.getAlbumById
  )
);

// Collection getter for GET /albums?ids=a,b,c. The upstream only resolves a
// single id per call, so each id is fetched through getAlbumById (which has
// proxy -> direct JioSaavn fallback and entity validation).
const getAlbums = async (ids) => {
  const list = parseIdList(ids);
  const found = (await mapLimit(list, 5, getAlbumById)).filter(Boolean);
  return { total: found.length, results: found };
};

const getArtistById = validateEntity(
  withFallback(
    async (id, opts = {}) => {
      const data = await saavnGet("/artists", { id, ...opts });
      return data?.data ? normalizeArtist(data.data) : null;
    },
    jiosaavn.getArtistById
  )
);

// Collection getter for GET /artists?ids=a,b,c. Same per-id strategy as
// getAlbums because the upstream multi-id response is unreliable.
const getArtists = async (ids) => {
  const list = parseIdList(ids);
  const found = (await mapLimit(list, 5, getArtistById)).filter(Boolean);
  return { total: found.length, results: found };
};

const getArtistSongs = withFallback(
  async (id, opts = {}) => {
    const { page, limit } = sanitizePagination(opts);
    const data = await saavnGet(`/artists/${id}/songs`, { page, sortBy: opts.sortBy || "popularity", sortOrder: opts.sortOrder || "desc", limit });
    const results = (data.data?.songs || []).map(normalizeTrack);
    return { total: data.data?.total || 0, results };
  },
  jiosaavn.getArtistSongs
);

const getArtistAlbums = withFallback(
  async (id, opts = {}) => {
    const { page, limit } = sanitizePagination(opts);
    const data = await saavnGet(`/artists/${id}/albums`, { page, limit });
    const results = (data.data?.albums || []).map(normalizeAlbum);
    return { total: data.data?.total || 0, results };
  },
  jiosaavn.getArtistAlbums
);

// Full playlist detail: GET /playlists?id=... The direct JioSaavn fallback has
// no clean playlist endpoint, so this is proxy-only.
const getPlaylistById = async (id) => {
  const data = await saavnGet("/playlists", { id });
  return data?.data && isValidEntity(data.data) ? normalizePlaylist(data.data) : null;
};

const getPlaylists = async (ids) => {
  const list = parseIdList(ids);
  const found = (await mapLimit(list, 5, getPlaylistById)).filter(Boolean);
  return { total: found.length, results: found };
};

const getLyrics = withFallback(
  async (id) => {
    const data = await saavnGet(`/songs/${id}/lyrics`);
    return data.data?.lyrics || null;
  },
  jiosaavn.getLyrics
);

// Fuzzy match on title + artist so we can find a song in the Saavn catalog
// when we only have Jamendo-style metadata (no Saavn song id).
// Unicode-aware: preserves letters from any script (Hindi, Tamil, etc.)
const normalizeName = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s*-\s*(original|official|full video|lyric|ft\.?)\s*.*/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// Rank matches by (title, artist) similarity. Returns best-scoring first.
const pickBestMatches = (tracks, artist, title, top = 4) => {
  const wantT = normalizeName(title);
  const wantA = normalizeName(artist);
  if (!wantT) return [];

  const scored = [];
  for (const t of tracks) {
    const tT = normalizeName(t.name);
    const tA = normalizeName(t.artist_name);
    if (!tT) continue;

    const titleMatch = tT === wantT ? 30 : tT.includes(wantT) || wantT.includes(tT) ? 12 : 0;
    if (!titleMatch) continue;
    const artistMatch =
      !wantA || !tA
        ? 0
        : tA === wantA
          ? 8
          : tA.includes(wantA) || wantA.includes(tA)
            ? 3
            : 0;
    if (titleMatch + artistMatch <= 0) continue;
    scored.push({ track: t, score: titleMatch + artistMatch });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, top).map((s) => s.track);
};

const getLyricsByTitle = withFallback(
  async (artist, title) => {
    const data = await saavnGet("/search/songs", { query: `${title} ${artist}`, page: 1, limit: 8 });
    const results = (data.data?.results || []).map((t) => ({
      ...normalizeTrack(t),
      lyricsId: t.lyricsId || "",
      hasLyrics: t.hasLyrics === true || t.hasLyrics === "true",
    }));
    const candidates = pickBestMatches(results, artist, title);
    if (!candidates.length) return null;

    for (const hit of candidates) {
      try {
        const lyricsData = await saavnGet(`/songs/${hit.lyricsId || hit.id}/lyrics`);
        if (lyricsData.data?.lyrics) return lyricsData.data.lyrics;
      } catch (err) {
        // 404 here just means this candidate has no lyrics — try the next one.
        if (err instanceof SaavnUnavailableError) continue;
        throw err;
      }
    }
    // None of the top matches served lyrics — let the JioSaavn fallback try.
    throw new SaavnUnavailableError(404, "lyrics-by-title");
  },
  jiosaavn.getLyricsByTitle
);

module.exports = {
  searchTracks,
  searchAlbums,
  searchArtists,
  searchPlaylists,
  getTrackById,
  getTracks,
  getTrackSuggestions,
  getAlbumById,
  getAlbums,
  getArtistById,
  getArtists,
  getArtistSongs,
  getArtistAlbums,
  getPlaylistById,
  getPlaylists,
  getLyrics,
  getLyricsByTitle,
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  getImage,
};
