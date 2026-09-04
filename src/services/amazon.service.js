const axios = require("axios");
const amazonConfig = require("../config/amazon");
const { httpAgent, httpsAgent } = require("../config/http");
const { getCache, setCache, makeCacheKey } = require("./cache.service");
const { retry } = require("../utils/retry");
const {
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
} = require("./amazon.mappers");

const client = axios.create({
  baseURL: amazonConfig.baseURL,
  timeout: 30000, // Amazon metadata calls can be slow (extra duration lookups)
  httpAgent,
  httpsAgent,
});

const clampLimit = (limit) => Math.min(Math.max(parseInt(limit, 10) || 10, 1), 10);
const clampPage = (page) => Math.min(Math.max(parseInt(page, 10) || 1, 1), 25);

class AmazonError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "AmazonError";
    this.status = status;
  }
}

const isNotFound = (err) =>
  err instanceof AmazonError && (err.status === 404 || err.status === 400);

const amzGet = async (path, params = {}) => {
  const cacheKey = makeCacheKey(`amz:${path}`, params);
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const data = await retry(
    async () => {
      try {
        const res = await client.get(path, { params });
        return res.data;
      } catch (err) {
        if (err.response) {
          throw new AmazonError(
            err.response.data?.message ||
              `Amazon API ${err.response.status} on ${path}`,
            err.response.status
          );
        }
        throw new AmazonError(`Amazon API unreachable on ${path}`);
      }
    },
    {
      retries: 2,
      baseMs: 400,
      shouldRetry: (err) => !(err instanceof AmazonError && err.status < 500 && err.status !== 429),
    }
  );

  if (!data || data.success === false) {
    throw new AmazonError(data?.message || `Amazon API error on ${path}`);
  }

  setCache(cacheKey, data);
  return data;
};

const search = async (query, opts = {}) => {
  const limit = clampLimit(opts.limit);
  const page = clampPage(opts.page);
  const type = String(opts.type || "all").toLowerCase();

  const call = async (path) => {
    const data = await amzGet(path, { query, page, limit });
    return data.data || [];
  };

  const results = {};
  let total = 0;

  const queries = [];
  if (type === "all" || type === "track") queries.push(["track", "/search/songs"]);
  if (type === "all" || type === "album") queries.push(["album", "/search/albums"]);
  if (type === "all" || type === "artist") queries.push(["artist", "/search/artists"]);
  if (type === "all" || type === "playlist") queries.push(["playlist", "/search/playlists"]);

  if (!queries.length) queries.push(["track", "/search/songs"]);

  await Promise.allSettled(
    queries.map(async ([key, path]) => {
      const items = await call(path);
      switch (key) {
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

  for (const key of ["track", "album", "artist", "playlist"]) {
    if (!results[key]) results[key] = [];
  }

  return { total, results };
};

const getTrackById = async (id) => {
  try {
    const data = await amzGet(`/songs/${id}`);
    return normalizeTrack(data.data);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

const getAlbumById = async (id) => {
  try {
    const data = await amzGet(`/albums/${id}`);
    return normalizeAlbum(data.data);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

const getArtistById = async (id) => {
  try {
    const data = await amzGet(`/artists/${id}`);
    return normalizeArtist(data.data);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

const getArtistTopTracks = async (id, opts = {}) => {
  try {
    const data = await amzGet(`/artists/${id}`);
    const topSongs = data.data?.topSongs || [];
    const results = topSongs.slice(0, clampLimit(opts.limit)).map(normalizeTrack).filter(Boolean);
    return { total: results.length, results };
  } catch (err) {
    if (isNotFound(err)) return { total: 0, results: [] };
    throw err;
  }
};

const getPlaylistById = async (id) => {
  try {
    const data = await amzGet(`/playlists/${id}`);
    return normalizePlaylist(data.data);
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
  getPlaylistById,
};
