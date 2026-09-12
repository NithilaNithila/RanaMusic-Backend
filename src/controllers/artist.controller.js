const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const { logger } = require("../services/logger.service");
const saavnService = require("../services/saavn.service");
const { sanitizeLang } = require("../config/languages");
const { getArtistPool } = require("../utils/artistPool");

const getArtists = asyncHandler(async (req, res) => {
  const lang = sanitizeLang(req.query.lang);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 8, 1), 500);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const rawOffset =
    req.query.offset !== undefined
      ? Math.max(parseInt(req.query.offset, 10) || 0, 0)
      : (page - 1) * limit;
  const start = rawOffset;

  const pool = await getArtistPool(lang);

  return ApiResponse.success(res, pool.slice(start, start + limit));
});

const searchArtists = asyncHandler(async (req, res) => {
  const { q, page, limit } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);
  const data = await saavnService.searchArtists(q, { page, limit });
  return ApiResponse.success(res, data.results || []);
});

const getArtistById = asyncHandler(async (req, res) => {
  const artist = await saavnService.getArtistById(req.params.id);
  if (!artist) return ApiResponse.error(res, "Artist not found", 404);
  return ApiResponse.success(res, artist);
});

// Upstream serves artist albums in small pages (~10 entries each), so we
// simply keep walking pages until nothing new comes back.
const ARTIST_ALBUM_MAX_PAGES = 40;
const ARTIST_ALBUM_TIMEOUT_MS = 15000;

const getArtistAlbums = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 12, 1), 500);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const rawOffset =
    req.query.offset !== undefined
      ? Math.max(parseInt(req.query.offset, 10) || 0, 0)
      : (page - 1) * limit;
  const start = Math.min(rawOffset, 500 - limit);
  const wanted = Math.min(start + limit, 500);
  const seen = new Set();
  const results = [];
  let total = Infinity;
  const deadline = Date.now() + ARTIST_ALBUM_TIMEOUT_MS;

  for (let upPage = 0; upPage < ARTIST_ALBUM_MAX_PAGES && results.length < wanted; upPage += 1) {
    if (Date.now() > deadline) {
      logger.warn({ upPage, artistId: req.params.id }, "artist.getArtistAlbums timed out");
      break;
    }
    let batch = [];
    try {
      const data = await saavnService.getArtistAlbums(req.params.id, {
        page: upPage,
        limit: 50,
      });
      batch = data.results || [];
      if (data.total > 0) total = data.total;
    } catch (err) {
      logger.warn({ err: { message: err.message }, upPage, artistId: req.params.id }, "artist.getArtistAlbums page failed");
      break;
    }
    if (!batch.length) break;

    let fresh = 0;
    for (const album of batch) {
      if (!album || !album.id || seen.has(album.id)) continue;
      seen.add(album.id);
      results.push(album);
      fresh += 1;
    }

    // A page with no new albums means upstream started repeating itself.
    if (!fresh) break;
  }

  return ApiResponse.success(res, results.slice(start, start + limit));
});

const getArtistTracks = asyncHandler(async (req, res) => {
  const data = await saavnService.getArtistSongs(req.params.id);
  return ApiResponse.success(res, data.results || []);
});

module.exports = {
  getArtists,
  searchArtists,
  getArtistById,
  getArtistAlbums,
  getArtistTracks,
  // Reused by /api/discover so the trending-artist cards match the
  // "artists on the rise" roster (same TTL + day rotation per lang).
  getArtistPool,
};
