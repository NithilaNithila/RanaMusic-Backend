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
const { logger } = require("../services/logger.service");

// Walks pages of queries and returns a deduplicated list.  Starts with the
// day-picked query; if it yields zero results on the first page, the next
// query from the list is tried (up to all queries) so a bad upstream query
// never leaves the pool empty.
const aggregatePool = async (
  searchFn, // e.g. saavnService.searchTracks / searchAlbums
  queryList, // e.g. TRACK_QUERIES[lang] / ALBUM_QUERIES[lang]
  { pageSize = 40, maxPages = 15, cap = 500 } = {}
) => {
  const startIndex = queryList.indexOf(pick(queryList));
  const seen = new Set();
  const aggregated = [];

  // Try queries starting from the day-picked one, wrapping around the list.
  for (let qi = 0; qi < queryList.length && aggregated.length < cap; qi++) {
    const query = queryList[(startIndex + qi) % queryList.length];
    let consecutiveEmpty = 0;

    for (let upPage = 0; upPage < maxPages && aggregated.length < cap; upPage++) {
      let results = [];
      try {
        const data = await searchFn(query, { page: upPage, limit: pageSize });
        results = data.results || [];
      } catch (err) {
        logger.warn(
          { err: { message: err.message }, query, page: upPage },
          "Pool aggregation page fetch failed, skipping"
        );
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) break;
        continue;
      }

      consecutiveEmpty = results.length === 0 ? consecutiveEmpty + 1 : 0;

      for (const item of results) {
        if (!item || !item.id || seen.has(item.id)) continue;
        seen.add(item.id);
        aggregated.push(item);
        if (aggregated.length >= cap) break;
      }
      if (results.length < pageSize) break;
    }

    // Got results from this query — no need to try more queries.
    if (aggregated.length > 0) break;
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
