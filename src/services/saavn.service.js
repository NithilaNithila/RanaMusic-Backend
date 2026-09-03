const axios = require("axios");
const saavnConfig = require("../config/saavn");
const { httpAgent, httpsAgent } = require("../config/http");
const { logger } = require("./logger.service");
const { getCache, setCache, makeCacheKey } = require("./cache.service");
const { normalizeTrack, normalizeAlbum, normalizeArtist, normalizePlaylist, getImage } = require("./saavn.mappers");
const { sanitizePagination } = require("../utils/pagination");
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

  try {
    const { data } = await client.get(endpoint, { params });
    setCache(cacheKey, data);
    return data;
  } catch (err) {
    const status = err.response?.status;
    // A 404 on the lyrics endpoint does NOT mean the lyrics are missing:
    // the proxy frequently 404s songs that the direct JioSaavn API still
    // serves lyrics for. Throw so withFallback retries against JioSaavn
    // (which returns null when there genuinely are none).
    if (endpoint.includes("/lyrics") && status === 404) {
      throw new SaavnUnavailableError(status, endpoint);
    }
    // Fall back to direct JioSaavn on rate-limit / server errors AND on
    // network failures (no response: DNS, timeout, connection refused).
    if (status === 429 || status === 500 || status === 503 || !err.response) {
      logger.warn({ status: status || "unreachable", endpoint }, "Saavn API unavailable, falling back to direct JioSaavn");
      throw new SaavnUnavailableError(status || 0, endpoint);
    }
    throw err;
  }
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

const getAlbumById = validateEntity(
  withFallback(
    async (id) => {
      const data = await saavnGet("/albums", { id });
      return data?.data ? normalizeAlbum(data.data) : null;
    },
    jiosaavn.getAlbumById
  )
);

const getArtistById = validateEntity(
  withFallback(
    async (id, opts = {}) => {
      const data = await saavnGet("/artists", { id, ...opts });
      return data?.data ? normalizeArtist(data.data) : null;
    },
    jiosaavn.getArtistById
  )
);

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

const getLyrics = withFallback(
  async (id) => {
    const data = await saavnGet(`/songs/${id}/lyrics`);
    return data.data?.lyrics || null;
  },
  jiosaavn.getLyrics
);

// Fuzzy match on title + artist so we can find a song in the Saavn catalog
// when we only have Jamendo-style metadata (no Saavn song id).
const normalizeName = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s*-\s*(original|official|full video|lyric|ft\.?)\s*.*/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
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
  getAlbumById,
  getArtistById,
  getArtistSongs,
  getArtistAlbums,
  getLyrics,
  getLyricsByTitle,
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  getImage,
};
