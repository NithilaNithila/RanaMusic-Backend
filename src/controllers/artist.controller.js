const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const saavnService = require("../services/saavn.service");

const POPULAR_ARTISTS = [
  "arijit singh",
  "shreya ghoshal",
  "atif aslam",
  "a r rahman",
  "pritam",
  "sonu nigam",
  "neha kakkar",
  "darshan raval",
  "jubin nautiyal",
  "diljit dosanjh",
  "armaan malik",
  "badshah",
];

const getArtists = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 8, 12);
  const found = await Promise.allSettled(
    POPULAR_ARTISTS.slice(0, limit).map((q) =>
      saavnService.searchArtists(q, { page: 0, limit: 1 })
    )
  );
  const seen = new Set();
  const results = [];
  for (const batch of found) {
    if (batch.status !== "fulfilled") continue;
    for (const artist of batch.value.results || []) {
      if (!artist.id || seen.has(artist.id)) continue;
      seen.add(artist.id);
      results.push(artist);
    }
  }
  return ApiResponse.success(res, results.slice(0, limit));
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

const getArtistAlbums = asyncHandler(async (req, res) => {
  const data = await saavnService.getArtistAlbums(req.params.id);
  return ApiResponse.success(res, data.results || []);
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
};
