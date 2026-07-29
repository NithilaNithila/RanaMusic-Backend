const NodeCache = require("node-cache");

// stdTTL in seconds - 10 minutes default; Jamendo catalog data doesn't change fast
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

const getCache = (key) => cache.get(key);

const setCache = (key, value, ttlSeconds) => {
  if (ttlSeconds) {
    cache.set(key, value, ttlSeconds);
  } else {
    cache.set(key, value);
  }
};

const makeCacheKey = (prefix, params = {}) => {
  const sortedParams = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return `${prefix}:${sortedParams}`;
};

module.exports = { getCache, setCache, makeCacheKey, cache };
