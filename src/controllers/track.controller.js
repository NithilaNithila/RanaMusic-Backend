const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const { logger } = require("../services/logger.service");
const saavnService = require("../services/saavn.service");
const spotifyService = require("../services/spotify.service");
const amazonService = require("../services/amazon.service");
const { sanitizeLang, isLangValue, isInLanguage, TRACK_QUERIES } = require("../config/languages");
const { getCache, setCache, makeCacheKey, memoize } = require("../services/cache.service");
const { getPopularPool } = require("../utils/popularPool");
const { findFullTrack, resolvePlayableAudio, withTimeout } = require("../services/trackResolver.service");

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

// Finds a full, playable (Saavn) version of a track that only exists as a 30s
// Spotify preview or with no audio at all (Amazon). Falls back to the
// provider's own artwork so the row still shows a real cover.
const RESOLVE_TTL = 300;
// Misses stay cheap (a Saavn search chain may take many seconds), but short
// enough that a track which becomes resolvable later is retried promptly.
const RESOLVE_MISS_TTL = 60;
const resolveTrack = asyncHandler(async (req, res) => {
  const { name, artist, source, id } = req.query;
  if (!name) return ApiResponse.error(res, "Query param 'name' is required", 400);

  const cacheKey = makeCacheKey("resolve", { name, artist, source, id });
  const cached = getCache(cacheKey);
  if (cached) {
    if (cached.notFound) return ApiResponse.error(res, "No match found", 404);
    return ApiResponse.success(res, cached);
  }

  const resolved = await resolvePlayableAudio({
    name,
    artist: artist || "",
    audioUrl: "",
    duration: 0,
    source: source || "",
    id: id || "",
  });

  if (resolved && resolved.audioUrl) {
    const payload = { audio: resolved.audioUrl, duration: resolved.duration || 0, image: resolved.image || "" };
    setCache(cacheKey, payload, RESOLVE_TTL);
    return ApiResponse.success(res, payload, "Resolved playable track");
  }

  // No free playable copy, but YouTube Music has the song: hand the client the
  // videoId so it can embed youtube.com/embed/<videoId> client-side.
  if (resolved && resolved.videoId) {
    const payload = {
      videoId: resolved.videoId,
      image: resolved.image || "",
      needsYoutubeEmbed: true,
    };
    setCache(cacheKey, payload, RESOLVE_TTL);
    return ApiResponse.success(res, payload, "Resolved YouTube embed track");
  }

  // No full copy — return the provider's own artwork so the row still
  // shows a real cover.
  if (source && id) {
    const getters = {
      spotify: (trackId) => spotifyService.getTrackById(trackId),
      amazon: (trackId) => amazonService.getTrackById(trackId),
    };
    const getter = getters[String(source).toLowerCase()];
    if (getter) {
      try {
        // Artwork is a nice-to-have, never worth 30s+ of provider retries —
        // bound it so a miss returns fast instead of adding a second slow tail.
        const providerTrack = await withTimeout(getter(id), 5000);
        if (providerTrack && providerTrack.image) {
          const payload = { image: providerTrack.image };
          if (String(source).toLowerCase() === "amazon") {
            // No free (non-DRM) copy is available anywhere the resolver knows.
            // Signal the client to fall back to a playback session instead.
            payload.needsAmazonSession = true;
          }
          setCache(cacheKey, payload, RESOLVE_TTL);
          return ApiResponse.success(res, payload, "Resolved provider artwork");
        }
      } catch (err) {
        logger.warn({ err: { message: err.message }, source, id }, "resolveTrack artwork fetch failed");
      }
    }
  }

  // No playable copy and no artwork — remember the miss so repeated requests
  // for the same unresolvable track don't replay the whole slow search chain.
  setCache(cacheKey, { notFound: true }, RESOLVE_MISS_TTL);
  return ApiResponse.error(res, "No match found", 404);
});

module.exports = { searchTracks, getPopularTracks, getTrackById, resolveTrack };
