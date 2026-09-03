// Shared "daily popular" pool builder.
//
// The Home page's trending sections (tracks, albums) pick ONE source query
// per calendar day (see dayRotation) and paginate it until they've collected
// enough deduplicated items. This module centralises that aggregation so both
// the standalone endpoints (/tracks/popular, /albums) and the consolidated
// /api/discover feed reuse the exact same cached pool (same cache key) — no
// duplicate upstream calls, identical data.
const { makeCacheKey, memoize } = require("../services/cache.service");
const { pick } = require("./dayRotation");

// Walks pages of a single (day-picked) query and returns a deduplicated list.
// The query is chosen by day, so the returned set naturally changes daily.
const aggregatePool = async (
  searchFn, // e.g. saavnService.searchTracks / searchAlbums
  queryList, // e.g. TRACK_QUERIES[lang] / ALBUM_QUERIES[lang]
  { pageSize = 40, maxPages = 15, cap = 500 } = {}
) => {
  const query = pick(queryList);
  const seen = new Set();
  const aggregated = [];

  for (let upPage = 0; upPage < maxPages && aggregated.length < cap; upPage++) {
    const data = await searchFn(query, { page: upPage, limit: pageSize });
    const results = data.results || [];
    for (const item of results) {
      if (!item || !item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      aggregated.push(item);
      if (aggregated.length >= cap) break;
    }
    // A short page means the source is exhausted for this query.
    if (results.length < pageSize) break;
  }

  return aggregated;
};

// Returns the cached daily pool for a section, building it on a miss. Shared
// cache key per poolPrefix+lang means /tracks/popular, /albums and /discover
// all slice from the same pool.
//
// Uses `memoize` so that concurrent cache-miss requests (e.g. the first burst
// of /tracks/popular hits right after a restart or TTL expiry) share ONE
// upstream aggregation run instead of each firing its own N-page walk
// (thundering-herd protection) — identical to how /search and /discover guard
// their own expensive builds.
const getPopularPool = async ({
  poolPrefix,
  lang,
  searchFn,
  queryList,
  ttl = 600,
  options,
}) => {
  const poolKey = makeCacheKey(poolPrefix, { lang });
  return memoize(`memo:${poolKey}`, ttl, () => aggregatePool(searchFn, queryList, options));
};

module.exports = { aggregatePool, getPopularPool };
