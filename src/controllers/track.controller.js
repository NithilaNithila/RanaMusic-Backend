const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const saavnService = require("../services/saavn.service");

const searchTracks = asyncHandler(async (req, res) => {
  const { q, page, limit } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);
  const data = await saavnService.searchTracks(q, { page, limit });
  return ApiResponse.success(res, data.results || []);
});

const getPopularTracks = asyncHandler(async (req, res) => {
  const { limit } = req.query;
  const data = await saavnService.searchTracks("top bollywood hits", { page: 0, limit: limit || 20 });
  return ApiResponse.success(res, data.results || []);
});

const getTrackById = asyncHandler(async (req, res) => {
  const track = await saavnService.getTrackById(req.params.id);
  if (!track) return ApiResponse.error(res, "Track not found", 404);
  return ApiResponse.success(res, track);
});

module.exports = { searchTracks, getPopularTracks, getTrackById };
