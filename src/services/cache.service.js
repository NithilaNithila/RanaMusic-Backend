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

// node-cache throws ECACHEFULL once maxKeys is reached (see lib:411), which on
// a full store would 500 every cached route. Evict the oldest inserted key and
// retry once; if it still fails, drop the write — a cache miss is far cheaper
// than an error on live traffic.
const setCache = (key, value, ttlSeconds) => {
  try {
    setRaw(key, value, ttlSeconds);
  } catch (err) {
    if (err && err.errorcode !== "ECACHEFULL") throw err;
    const oldest = cache.keys()[0];
    if (oldest !== undefined) cache.del(oldest);
    try {
      setRaw(key, value, ttlSeconds);
    } catch (_) {
      // best-effort only
    }
  }
};

const setRaw = (key, value, ttlSeconds) => {
  if (ttlSeconds) {
    cache.set(key, value, ttlSeconds);
  } else {
    cache.set(key, value);
  }
};

const delCache = (key) => {
  cache.del(key);
};

// Params are sorted and URL-encoded so keys are always stable and any
// separator characters inside a value ("&", ":", "=") can't collide with or
// smuggle into another key's prefix structure.
const makeCacheKey = (prefix, params = {}) => {
  const sortedParams = Object.keys(params)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(String(params[k]))}`)
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

  // Bound the in-flight map: beyond a few thousand concurrent misses the
  // dedupe stops buying anything and the Map itself becomes a leak.
  if (inflight.size >= 5000) {
    return Promise.resolve()
      .then(loader)
      .then((value) => {
        setCache(key, value, ttlSeconds);
        return value;
      });
  }

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