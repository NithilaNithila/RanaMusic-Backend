const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const saavnService = require("../services/saavn.service");
const { sanitizeLang, isLangValue, isInLanguage, ALBUM_QUERIES } = require("../config/languages");
const { getCache, setCache, makeCacheKey } = require("../services/cache.service");
const { getPopularPool } = require("../utils/popularPool");

// Same story as popular tracks: upstream Saavn returns ~40 albums per
// request, so results are aggregated across pages until the requested
// amount is reached (hard ceiling 500) or the source runs dry.
const ALBUM_PAGE_SIZE = 40;
const ALBUM_MAX_PAGES = 15;
const ALBUM_TTL = 600; // aggregate once per lang, serve slices from cache

// Shared daily pool builder (also used by /api/discover).
const getAlbumPool = (lang) =>
  getPopularPool({
    poolPrefix: "albums:popular-pool",
    lang,
    searchFn: saavnService.searchAlbums,
    queryList: ALBUM_QUERIES[lang],
    ttl: ALBUM_TTL,
    options: { pageSize: ALBUM_PAGE_SIZE, maxPages: ALBUM_MAX_PAGES, cap: 500 },
  });

const getAlbums = asyncHandler(async (req, res) => {
  const lang = sanitizeLang(req.query.lang);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 500);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const rawOffset =
    req.query.offset !== undefined
      ? Math.max(parseInt(req.query.offset, 10) || 0, 0)
      : (page - 1) * limit;

  const key = makeCacheKey("albums:popular", { lang, limit, offset: rawOffset });
  const cached = getCache(key);
  if (cached) return ApiResponse.success(res, cached);

  // Aggregate once per lang (shared pool), then slice instantly on cache.
  const aggregated = await getAlbumPool(lang);

  const slice = aggregated.slice(rawOffset, rawOffset + limit);
  setCache(key, slice, ALBUM_TTL);
  return ApiResponse.success(res, slice);
});

const searchAlbums = asyncHandler(async (req, res) => {
  // Accept both `page` and `offset` so clients can page either way.
  // Upstream Saavn pages are 1-indexed; offset is converted accordingly.
  const { q, page, offset, limit } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);
  // Optional `lang` narrows results to that language's tagged albums. When
  // omitted, results are returned unfiltered.
  const lang = isLangValue(req.query.lang);
  const pageSize = Math.max(parseInt(limit, 10) || 20, 1);
  const resolvedPage =
    offset !== undefined
      ? Math.floor((parseInt(offset, 10) || 0) / pageSize) + 1
      : Math.max(parseInt(page, 10) || 1, 1);
  const data = await saavnService.searchAlbums(q, { page: resolvedPage, limit });
  let results = data.results || [];
  if (lang) results = results.filter((a) => isInLanguage(a, lang));
  return ApiResponse.success(res, results);
});

const getAlbumById = asyncHandler(async (req, res) => {
  const album = await saavnService.getAlbumById(req.params.id);
  if (!album) return ApiResponse.error(res, "Album not found", 404);
  return ApiResponse.success(res, album);
});

const getAlbumTracks = asyncHandler(async (req, res) => {
  const album = await saavnService.getAlbumById(req.params.id);
  if (!album) return ApiResponse.error(res, "Album not found", 404);
  return ApiResponse.success(res, album.songs || []);
});

module.exports = { getAlbums, searchAlbums, getAlbumById, getAlbumTracks };
