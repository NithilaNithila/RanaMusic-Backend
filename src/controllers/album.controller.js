const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const saavnService = require("../services/saavn.service");

const getAlbums = asyncHandler(async (req, res) => {
  const { limit } = req.query;
  const data = await saavnService.searchAlbums("top bollywood albums", { page: 0, limit: limit || 20 });
  return ApiResponse.success(res, data.results || []);
});

const searchAlbums = asyncHandler(async (req, res) => {
  const { q, page, limit } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);
  const data = await saavnService.searchAlbums(q, { page, limit });
  return ApiResponse.success(res, data.results || []);
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
