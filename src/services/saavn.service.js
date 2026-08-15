const axios = require("axios");
const saavnConfig = require("../config/saavn");
const { getCache, setCache, makeCacheKey } = require("./cache.service");
const { normalizeTrack, normalizeAlbum, normalizeArtist, getImage } = require("./saavn.mappers");
const { sanitizePagination } = require("../utils/pagination");
const jiosaavn = require("./jiosaavn.service");

const client = axios.create({
  baseURL: saavnConfig.baseURL,
  timeout: 10000,
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
    if (endpoint.includes("/lyrics") && status === 404) {
      return { data: { lyrics: null } };
    }
    // Fall back to direct JioSaavn on rate-limit / server errors AND on
    // network failures (no response: DNS, timeout, connection refused).
    if (status === 429 || status === 500 || status === 503 || !err.response) {
      console.warn(`Saavn API ${status || "unreachable"} on ${endpoint}, falling back to direct JioSaavn`);
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
    const { limit } = sanitizePagination(opts);
    const data = await saavnGet(`/artists/${id}/albums`, { limit });
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

module.exports = {
  searchTracks,
  searchAlbums,
  searchArtists,
  getTrackById,
  getAlbumById,
  getArtistById,
  getArtistSongs,
  getArtistAlbums,
  getLyrics,
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  getImage,
};
