const NodeCache = require("node-cache");

// stdTTL in seconds - 10 minutes default; catalog data doesn't change fast
const cache = new NodeCache({
  stdTTL: 600,
  checkperiod: 120,
  maxKeys: 10000, // prevent unbounded memory growth
});

// Tracks in-flight cache-miss promises so concurrent identical requests
// share ONE upstream fetch instead of N (thundering-herd protection).
const inflight = new Map();

const getCache = (key) => cache.get(key);

const setCache = (key, value, ttlSeconds) => {
  if (ttlSeconds) {
    cache.set(key, value, ttlSeconds);
  } else {
    cache.set(key, value);
  }
};

const delCache = (key) => {
  cache.del(key);
};

const makeCacheKey = (prefix, params = {}) => {
  const sortedParams = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return `${prefix}:${sortedParams}`;
};

// Memoizes the result of `loader`.
// - If a cached value exists, returns it instantly.
// - If the same key is already being fetched, shares the in-flight promise.
// - Otherwise calls `loader`, stores the result, and returns it.
// `ttlSeconds` is optional (uses cache default otherwise).
const memoize = (key, ttlSeconds, loader) => {
  const cached = getCache(key);
  if (cached !== undefined) return Promise.resolve(cached);

  if (inflight.has(key)) return inflight.get(key);

  const promise = Promise.resolve()
    .then(loader)
    .then((value) => {
      setCache(key, value, ttlSeconds);
      inflight.delete(key);
      return value;
    })
    .catch((err) => {
      // Don't cache failures; let next request retry.
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise;
};

module.exports = { getCache, setCache, delCache, makeCacheKey, memoize, cache };