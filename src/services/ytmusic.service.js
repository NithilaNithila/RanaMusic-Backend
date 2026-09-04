const axios = require("axios");
const ytConfig = require("../config/ytmusic");
const { httpAgent, httpsAgent } = require("../config/http");
const { logger } = require("./logger.service");
const { getCache, setCache, makeCacheKey } = require("./cache.service");
const { retry } = require("../utils/retry");
const {
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
} = require("./ytmusic.mappers");

const client = axios.create({
  baseURL: ytConfig.baseURL,
  timeout: 20000, // Render free-tier cold starts are slow
  httpAgent,
  httpsAgent,
});

const clampLimit = (limit) => Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
const clampOffset = (offset) => Math.max(parseInt(offset, 10) || 0, 0);

class YtUpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "YtUpstreamError";
    this.status = status;
  }
}

const isNotFound = (err) =>
  err instanceof YtUpstreamError && (err.status === 404 || err.status === 400);

const ytGet = async (path, params = {}) => {
  const cacheKey = makeCacheKey(`ytmusic:${path}`, params);
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const data = await retry(
    async () => {
      try {
        const res = await client.get(path, { params });
        return res.data;
      } catch (err) {
        const status = err.response?.status;
        throw new YtUpstreamError(
          err.response?.data?.detail || `ytmusic ${status || "unreachable"} on ${path}`,
          status || 502
        );
      }
    },
    {
      retries: 2,
      baseMs: 400,
      shouldRetry: (err) => !(err instanceof YtUpstreamError && err.status < 500 && err.status !== 429),
    }
  );
  // Only cache valid responses — skip error payloads that arrived with HTTP 200.
  if (data && (Array.isArray(data) || typeof data === "object") && !data.error) {
    setCache(cacheKey, data);
  }
  return data;
};

const SEARCH_FILTERS = {
  track: "songs",
  album: "albums",
  artist: "artists",
  playlist: "playlists",
};

const SEARCH_TYPES = Object.keys(SEARCH_FILTERS);

const resolveSearchTypes = (type) => {
  if (!type || type === "all")
    return SEARCH_TYPES;
  const requested = String(type)
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => SEARCH_TYPES.includes(t));
  return requested.length ? requested : ["track"];
};

const search = async (query, opts = {}) => {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  const types = resolveSearchTypes(opts.type);

  const results = {};
  let total = 0;

  await Promise.allSettled(
    types.map(async (type) => {
      const data = await ytGet("/search", {
        query,
        filter: SEARCH_FILTERS[type],
        limit,
        offset,
      });
      const items = (Array.isArray(data) ? data : [])
        .map((item) => normalizeResult(item, type))
        .filter(Boolean)
        .slice(0, limit);
      results[type] = items;
      total += items.length;
    })
  );

  for (const type of types) {
    if (!results[type]) results[type] = [];
  }

  return { total, results };
};

const normalizeResult = (item, type) => {
  switch (type) {
    case "track":
      return normalizeTrack(item);
    case "album":
      return normalizeAlbum(item, item.browseId);
    case "artist":
      return normalizeArtist(item);
    case "playlist":
      return normalizePlaylist(item);
    default:
      return null;
  }
};

const searchSuggestions = async (query) => {
  const data = await ytGet("/search/suggestions", { query });
  return Array.isArray(data) ? data : [];
};

const getTrackById = async (id) => {
  try {
    const data = await ytGet(`/watch-playlist/${id}`, { limit: 1 });
    const tracks = data.tracks || [];
    return tracks.length ? normalizeTrack(tracks[0]) : null;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

const getLyrics = async (id) => {
  try {
    const data = await ytGet(`/lyrics/${id}`);
    return (data && (data.lyrics || data.text)) || null;
  } catch (err) {
    logger.warn({ err: { message: err.message }, id }, "ytmusic getLyrics failed");
    return null;
  }
};

const getAlbumById = async (id) => {
  try {
    const data = await ytGet(`/album/${id}`);
    return normalizeAlbum(data, id);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

const getArtistById = async (id) => {
  try {
    const data = await ytGet(`/artist/${id}`);
    return normalizeArtist(data);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

const getArtistTopTracks = async (id) => {
  try {
    const data = await ytGet(`/artist/${id}`);
    const results = (data.songs?.results || []).map(normalizeTrack).filter(Boolean);
    return { total: results.length, results };
  } catch (err) {
    if (isNotFound(err)) return { total: 0, results: [] };
    throw err;
  }
};

const getArtistAlbums = async (id) => {
  try {
    const data = await ytGet(`/artist/${id}`);
    const raw = data.albums?.results || [];
    const results = raw
      .map((album) => normalizeAlbum(album, album.browseId))
      .filter(Boolean);
    return { total: results.length, results };
  } catch (err) {
    if (isNotFound(err)) return { total: 0, results: [] };
    throw err;
  }
};

const getPlaylistById = async (id) => {
  try {
    const data = await ytGet(`/playlist/${id}`, { limit: 100 });
    return normalizePlaylist(data);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

module.exports = {
  search,
  searchSuggestions,
  getTrackById,
  getLyrics,
  getAlbumById,
  getArtistById,
  getArtistTopTracks,
  getArtistAlbums,
  getPlaylistById,
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
};