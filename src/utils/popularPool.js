// Shared "daily popular" pool builder.
//
// The Home page's trending sections (tracks, albums) pick ONE source query
// per calendar day (see dayRotation) and paginate it until they've collected
// enough deduplicated items. This module centralises that aggregation so both
// the standalone endpoints (/tracks/popular, /albums) and the consolidated
// /api/discover feed reuse the exact same cached pool (same cache key) — no
// duplicate upstream calls, identical data.
const { getCache, setCache, makeCacheKey, memoize, delCache } = require("../services/cache.service");
const { pick } = require("./dayRotation");
const { logger } = require("../services/logger.service");
const mapLimit = require("./mapLimit");

// Fetches a single page, returning { results, page } for ordered merging.
const fetchPage = async (searchFn, query, page, pageSize) => {
  try {
    const data = await searchFn(query, { page, limit: pageSize });
    return { results: data.results || [], page };
  } catch (err) {
    logger.warn(
      { err: { message: err.message }, query, page },
      "Pool aggregation page fetch failed, skipping"
    );
    return { results: [], page };
  }
};

// Walks pages of queries and returns a deduplicated list.  Starts with the
// day-picked query; if it yields zero results on the first page, the next
// query from the list is tried (up to all queries) so a bad upstream query
// never leaves the pool empty.
//
// The first two pages are walked sequentially so short / unproductive sources
// stop immediately without over-fetching (matching the upstream's early-exit
// semantics). Once a query proves productive (page 0 and 1 are both full), the
// remaining pages are fetched in bounded parallel batches for a faster build.
const aggregatePool = async (
  searchFn, // e.g. saavnService.searchTracks / searchAlbums
  queryList, // e.g. TRACK_QUERIES[lang] / ALBUM_QUERIES[lang]
  { pageSize = 40, maxPages = 15, cap = 500, concurrency = 5 } = {}
) => {
  const startIndex = queryList.indexOf(pick(queryList));
  const seen = new Set();
  const aggregated = [];
  let consecutiveEmpty = 0;

  // Merges one page's results (dedup + cap) and reports whether the walk
  // should keep going. A short page (< pageSize), 3 consecutive empties, or
  // reaching the cap all stop the walk.
  const consume = (results) => {
    let done = false;
    consecutiveEmpty = results.length === 0 ? consecutiveEmpty + 1 : 0;
    if (consecutiveEmpty >= 3) done = true;
    for (const item of results) {
      if (!item || !item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      aggregated.push(item);
      if (aggregated.length >= cap) {
        done = true;
        break;
      }
    }
    if (results.length < pageSize) done = true;
    return !done;
  };

  // Try queries starting from the day-picked one, wrapping around the list.
  for (let qi = 0; qi < queryList.length; qi++) {
    const query = queryList[(startIndex + qi) % queryList.length];
    consecutiveEmpty = 0;
    let keepGoing = true;

    // Sequential walk of the first two pages to detect short sources fast.
    for (let p = 0; p < Math.min(2, maxPages) && keepGoing; p++) {
      const { results } = await fetchPage(searchFn, query, p, pageSize);
      keepGoing = consume(results);
    }
    if (aggregated.length >= cap) break;

    // Query is productive — fetch the remaining pages in parallel batches.
    if (keepGoing) {
      let upPage = 2;
      while (upPage < maxPages && aggregated.length < cap) {
        const batch = Math.min(concurrency, maxPages - upPage);
        const pageIndices = Array.from({ length: batch }, (_, i) => upPage + i);
        const pageResults = await mapLimit(pageIndices, concurrency, (p) =>
          fetchPage(searchFn, query, p, pageSize)
        );
        for (const { results } of pageResults.sort((a, b) => a.page - b.page)) {
          keepGoing = consume(results);
          if (!keepGoing || aggregated.length >= cap) break;
        }
        upPage += batch;
        if (!keepGoing) break;
      }
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
  floor = 10,
}) => {
  const poolKey = makeCacheKey(poolPrefix, { lang });
  const cached = getCache(poolKey);
  if (cached !== undefined) return cached;

  const pool = await memoize(`memo:${poolKey}`, ttl, () => aggregatePool(searchFn, queryList, options));

  // A healthy pool is cached for the full TTL. A near-empty one (upstream
  // down/broken at build time) gets a SHORT life and its memo cleared so the
  // endpoint recovers quickly instead of serving a broken pool for minutes.
  const healthy = pool.length >= floor;
  setCache(poolKey, pool, healthy ? ttl : 30);
  if (!healthy) delCache(`memo:${poolKey}`);
  return pool;
};

module.exports = { aggregatePool, getPopularPool };
