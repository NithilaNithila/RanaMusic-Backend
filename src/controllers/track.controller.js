const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const { logger } = require("../services/logger.service");
const saavnService = require("../services/saavn.service");
const spotifyService = require("../services/spotify.service");
const ytmusicService = require("../services/ytmusic.service");
const amazonService = require("../services/amazon.service");
const { sanitizeLang, isLangValue, isInLanguage, TRACK_QUERIES } = require("../config/languages");
const { getCache, setCache, makeCacheKey } = require("../services/cache.service");
const { getPopularPool } = require("../utils/popularPool");

// Upstream Saavn search tops out around 40 results per request, so popular
// tracks are aggregated across pages until the requested amount is reached
// (hard ceiling 500) or the source runs dry.
const POPULAR_PAGE_SIZE = 40;
const POPULAR_MAX_PAGES = 15;
// Popular tracks are expensive (up to 15 upstream calls). Cache for 10 min.
const POPULAR_TTL = 600;

// Shared daily pool builder (also used by /api/discover). Builds the full
// deduped pool once per lang per 10 min, then slices for each request.
const getTrackPool = (lang) =>
  getPopularPool({
    poolPrefix: "tracks:popular-pool",
    lang,
    searchFn: saavnService.searchTracks,
    queryList: TRACK_QUERIES[lang],
    ttl: POPULAR_TTL,
    options: { pageSize: POPULAR_PAGE_SIZE, maxPages: POPULAR_MAX_PAGES, cap: 500 },
  });

const searchTracks = asyncHandler(async (req, res) => {
  // Accept both `page` and `offset` so clients can page either way.
  // Upstream Saavn pages are 1-indexed; offset is converted accordingly.
  const { q, page, offset, limit } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);
  // Optional `lang` narrows results to that language's tagged tracks. When
  // omitted, results are returned unfiltered.
  const lang = isLangValue(req.query.lang);
  const pageSize = Math.max(parseInt(limit, 10) || 20, 1);
  const resolvedPage =
    offset !== undefined
      ? Math.floor((parseInt(offset, 10) || 0) / pageSize) + 1
      : Math.max(parseInt(page, 10) || 1, 1);
  const data = await saavnService.searchTracks(q, { page: resolvedPage, limit });
  let results = data.results || [];
  if (lang) results = results.filter((t) => isInLanguage(t, lang));
  return ApiResponse.success(res, results);
});

const getPopularTracks = asyncHandler(async (req, res) => {
  const lang = sanitizeLang(req.query.lang);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 500);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const rawOffset =
    req.query.offset !== undefined
      ? Math.max(parseInt(req.query.offset, 10) || 0, 0)
      : (page - 1) * limit;

  const key = makeCacheKey("tracks:popular", { lang, limit, offset: rawOffset });
  const cached = getCache(key);
  if (cached) return ApiResponse.success(res, cached);

  // Aggregate once per lang (shared pool), then slice instantly on cache.
  const aggregated = await getTrackPool(lang);

  const slice = aggregated.slice(rawOffset, rawOffset + limit);
  setCache(key, slice, POPULAR_TTL);
  return ApiResponse.success(res, slice);
});

const getTrackById = asyncHandler(async (req, res) => {
  const track = await saavnService.getTrackById(req.params.id);
  if (!track) return ApiResponse.error(res, "Track not found", 404);
  return ApiResponse.success(res, track);
});

const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    // Drop parenthetical / bracketed suffixes ("Jaane Kyu (From Tu...)")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Finds a full, playable (Saavn) version of a track that only exists as a
// 30s Spotify preview or with no audio at all (YouTube / Amazon). Uses a
// name + artist match scored against the Saavn search results.
const resolveTrack = asyncHandler(async (req, res) => {
  const { name, artist, source, id } = req.query;
  if (!name) return ApiResponse.error(res, "Query param 'name' is required", 400);

  const query = [name, artist].filter(Boolean).join(" ").trim().slice(0, 120);
  const data = await saavnService.searchTracks(query, { page: 1, limit: 20 });
  const results = data.results || [];

  const qName = normalize(name);
  const qArtists = String(artist || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  let best = null;
  let bestScore = 0;

  for (const t of results) {
    if (!t || !t.audio) continue;
    const tName = normalize(t.name);
    const tArtists = String(t.artist_name || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    let score = 0;
    if (tName === qName) score += 40;
    else if (tName.includes(qName) || qName.includes(tName)) score += 20;

    if (qArtists.length && tArtists.length) {
      const hits = qArtists.filter((a) =>
        tArtists.some((ta) => ta.includes(a) || a.includes(ta))
      ).length;
      score += Math.min(hits, 3) * 10;
    }

    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }

  if (bestScore >= 20) {
    return ApiResponse.success(res, best, "Resolved playable track");
  }

  // No full Saavn copy — the track only plays as a 30s preview / nothing.
  // If the caller told us which provider it came from, return that
  // provider's own artwork (image only, never fabricate full audio) so the
  // row still shows a real cover.
  if (source && id) {
    const getters = {
      spotify: (trackId) => spotifyService.getTrackById(trackId),
      ytmusic: (trackId) => ytmusicService.getTrackById(trackId),
      amazon: (trackId) => amazonService.getTrackById(trackId),
    };
    const getter = getters[String(source).toLowerCase()];
    if (getter) {
      try {
        const providerTrack = await getter(id);
        if (providerTrack && providerTrack.image) {
          return ApiResponse.success(res, { image: providerTrack.image }, "Resolved provider artwork");
        }
      } catch (err) {
        logger.warn({ err: { message: err.message }, source, id }, "resolveTrack artwork fetch failed");
      }
    }
  }

  return ApiResponse.error(res, "No match found", 404);
});

module.exports = { searchTracks, getPopularTracks, getTrackById, resolveTrack };
