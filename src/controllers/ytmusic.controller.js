const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const ytmusicService = require("../services/ytmusicSearch.service");

const search = asyncHandler(async (req, res) => {
  const { q, type, limit, offset } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);
  const data = await ytmusicService.search(q, { type, limit, offset });
  return ApiResponse.success(res, data.results || [], `Found ${data.total} results`);
});

const getAlbumById = asyncHandler(async (req, res) => {
  const album = await ytmusicService.getAlbumById(req.params.id);
  if (!album) return ApiResponse.error(res, "Album not found", 404);
  return ApiResponse.success(res, album);
});

const getAlbumTracks = asyncHandler(async (req, res) => {
  const album = await ytmusicService.getAlbumById(req.params.id);
  if (!album) return ApiResponse.error(res, "Album not found", 404);
  // YT Music album songs carry videoIds the client embeds (browser-side
  // stream); no full audio comes from the provider.
  return ApiResponse.success(res, album.songs || []);
});

const getPlaylistById = asyncHandler(async (req, res) => {
  const playlist = await ytmusicService.getPlaylistById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);
  return ApiResponse.success(res, playlist);
});

const getPlaylistTracks = asyncHandler(async (req, res) => {
  const playlist = await ytmusicService.getPlaylistById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);
  return ApiResponse.success(res, playlist.songs || []);
});

module.exports = {
  search,
  getAlbumById,
  getAlbumTracks,
  getPlaylistById,
  getPlaylistTracks,
};