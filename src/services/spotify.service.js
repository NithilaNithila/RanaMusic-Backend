const axios = require("axios");
const spotifyConfig = require("../config/spotify");
const { httpAgent, httpsAgent } = require("../config/http");
const { getCache, setCache, makeCacheKey } = require("./cache.service");
const { retry } = require("../utils/retry");
const {
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
} = require("./spotify.mappers");

const client = axios.create({
  baseURL: spotifyConfig.baseURL,
  timeout: 10000,
  httpAgent,
  httpsAgent,
});

const clampLimit = (limit) => Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
const clampOffset = (offset) => Math.max(parseInt(offset, 10) || 0, 0);

class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

const isNotFound = (err) =>
  err instanceof UpstreamError && (err.status === 404 || err.status === 400);

const wxfGet = async (path, params = {}) => {
  const cacheKey = makeCacheKey(`wolfx:${path}`, params);
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const data = await retry(
    async () => {
      try {
        const res = await client.get(path, { params });
        return res.data;
      } catch (err) {
        if (err.response) {
          throw new UpstreamError(
            err.response.data?.error || `wolfXspotify ${err.response.status} on ${path}`,
            err.response.status
          );
        }
        throw new UpstreamError(`wolfXspotify unreachable on ${path}`);
      }
    },
    {
      retries: 2,
      baseMs: 400,
      shouldRetry: (err) => !(err instanceof UpstreamError && err.status < 500 && err.status !== 429),
    }
  );

  if (!data || data.success === false) {
    throw new UpstreamError(data?.error || `wolfXspotify error on ${path}`);
  }

  setCache(cacheKey, data);
  return data;
};

const SEARCH_TYPES = ["track", "album", "artist", "playlist"];

const resolveSearchTypes = (type) => {
  if (type === "all") return SEARCH_TYPES;
  const requested = String(type || "track")
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
      const data = await wxfGet("/search", { q: query, type, limit, offset });
      const items = data.results || [];
      switch (type) {
        case "track":
          results.track = items.map(normalizeTrack).filter(Boolean);
          break;
        case "album":
          results.album = items.map(normalizeAlbum).filter(Boolean);
          break;
        case "artist":
          results.artist = items.map(normalizeArtist).filter(Boolean);
          break;
        case "playlist":
          results.playlist = items.map(normalizePlaylist).filter(Boolean);
          break;
      }
      total += items.length;
    })
  );

  for (const type of types) {
    if (!results[type]) results[type] = [];
  }

  return { total, results };
};

const getTrackById = async (id) => {
  try {
    const data = await wxfGet(`/track/${id}`);
    return normalizeTrack(data.track);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

const getAlbumById = async (id) => {
  try {
    const data = await wxfGet(`/album/${id}`);
    return normalizeAlbum(data.album);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

const getArtistById = async (id) => {
  try {
    const data = await wxfGet(`/artist/${id}`);
    return normalizeArtist(data.artist);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

const getArtistTopTracks = async (id) => {
  try {
    const data = await wxfGet(`/artist/${id}/top-tracks`);
    const results = (data.tracks || []).map(normalizeTrack).filter(Boolean);
    return { total: data.total || results.length, results };
  } catch (err) {
    if (isNotFound(err)) return { total: 0, results: [] };
    throw err;
  }
};

const getArtistAlbums = async (id, opts = {}) => {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  const type = opts.type || "album";
  try {
    const data = await wxfGet(`/artist/${id}/albums`, { type, limit, offset });
    const results = (data.albums || []).map(normalizeAlbum).filter(Boolean);
    return { total: data.total || results.length, results };
  } catch (err) {
    if (isNotFound(err)) return { total: 0, results: [] };
    throw err;
  }
};

const getPlaylistById = async (id) => {
  try {
    const data = await wxfGet(`/playlist/${id}`);
    return normalizePlaylist(data.playlist);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

module.exports = {
  search,
  getTrackById,
  getAlbumById,
  getArtistById,
  getArtistTopTracks,
  getArtistAlbums,
  getPlaylistById,
};