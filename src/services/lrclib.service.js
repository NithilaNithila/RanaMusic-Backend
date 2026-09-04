const axios = require("axios");
const { httpAgent, httpsAgent } = require("../config/http");
const { logger } = require("./logger.service");
const { getCache, setCache, makeCacheKey } = require("./cache.service");
const { retry } = require("../utils/retry");

const client = axios.create({
  timeout: 8000,
  httpAgent,
  httpsAgent,
  headers: {
    "User-Agent": "RanaMusic/1.0",
    Accept: "application/json",
  },
});

// Free, keyless public API for synced + plain lyrics via artist/title.
const getLyrics = async (artist, title) => {
  if (!artist || !title) return null;
  const cacheKey = makeCacheKey("lrclib", { artist, title });
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const data = await retry(
      async () => {
        const res = await client.get("https://lrclib.net/api/get", {
          params: { artist_name: artist, track_name: title },
        });
        return res.data;
      },
      { retries: 1, baseMs: 300 }
    );
    const lyrics = data?.plainLyrics || data?.syncedLyrics || null;
    if (lyrics) setCache(cacheKey, lyrics);
    return lyrics;
  } catch (err) {
    logger.warn({ err: { message: err.message }, title, artist }, "lrclib getLyrics failed");
    return null;
  }
};

module.exports = { getLyrics };