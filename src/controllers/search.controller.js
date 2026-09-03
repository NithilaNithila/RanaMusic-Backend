const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const searchService = require("../services/search.service");
const { getCache, setCache, makeCacheKey } = require("../services/cache.service");

// Unified search hits 4 external upstreams (Saavn, Spotify, YT, Amazon) -
// up to 10-30s if uncached. Cache results for 5 minutes so repeat searches
// return near-instantly.
const SEARCH_TTL = 300;

const search = asyncHandler(async (req, res) => {
  const { q, type, limit, offset } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);

  const key = makeCacheKey("search", {
    q: String(q).trim().toLowerCase(),
    type: type || "all",
    limit: limit || 20,
    offset: offset || 0,
  });

  const cached = getCache(key);
  if (cached) {
    return ApiResponse.success(res, cached.results, `Found ${cached.total} results`);
  }

  const data = await searchService.search(q, { type, limit, offset });

  // Only cache successful searches; cache failures so brief crashes don't
  // hammer all 4 upstreams on every poll.
  const payload = { results: data.results, total: data.total };
  setCache(key, payload, SEARCH_TTL);

  return ApiResponse.success(res, data.results, `Found ${data.total} results`);
});

module.exports = { search };