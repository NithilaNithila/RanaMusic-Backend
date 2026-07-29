const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const saavnService = require("../services/saavn.service");

const getArtists = asyncHandler(async (req, res) => {
  const { limit } = req.query;
  const data = await saavnService.searchArtists("bollywood singers", { page: 0, limit: limit || 20 });
  return ApiResponse.success(res, data.results || []);
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
