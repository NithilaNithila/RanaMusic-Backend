const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const amazonService = require("../services/amazon.service");

const search = asyncHandler(async (req, res) => {
  const { q, type, limit, page } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);
  const data = await amazonService.search(q, { type, limit, page });
  return ApiResponse.success(res, data.results || [], `Found ${data.total} results`);
});

const getTrackById = asyncHandler(async (req, res) => {
  const track = await amazonService.getTrackById(req.params.id);
  if (!track) return ApiResponse.error(res, "Track not found", 404);
  return ApiResponse.success(res, track);
});

const getAlbumById = asyncHandler(async (req, res) => {
  const album = await amazonService.getAlbumById(req.params.id);
  if (!album) return ApiResponse.error(res, "Album not found", 404);
  return ApiResponse.success(res, album);
});

const getAlbumTracks = asyncHandler(async (req, res) => {
  const album = await amazonService.getAlbumById(req.params.id);
  if (!album) return ApiResponse.error(res, "Album not found", 404);
  return ApiResponse.success(res, album.songs || []);
});

const getArtistById = asyncHandler(async (req, res) => {
  const artist = await amazonService.getArtistById(req.params.id);
  if (!artist) return ApiResponse.error(res, "Artist not found", 404);
  return ApiResponse.success(res, artist);
});

const getArtistTopTracks = asyncHandler(async (req, res) => {
  const { limit } = req.query;
  const data = await amazonService.getArtistTopTracks(req.params.id, { limit });
  return ApiResponse.success(res, data.results || []);
});

const getPlaylistById = asyncHandler(async (req, res) => {
  const playlist = await amazonService.getPlaylistById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);
  return ApiResponse.success(res, playlist);
});

const getPlaylistTracks = asyncHandler(async (req, res) => {
  const playlist = await amazonService.getPlaylistById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);
  return ApiResponse.success(res, playlist.songs || []);
});

module.exports = {
  search,
  getTrackById,
  getAlbumById,
  getAlbumTracks,
  getArtistById,
  getArtistTopTracks,
  getPlaylistById,
  getPlaylistTracks,
};
