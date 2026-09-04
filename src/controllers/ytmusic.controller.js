const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const ytService = require("../services/ytmusic.service");

const search = asyncHandler(async (req, res) => {
  const { q, type, limit, offset } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);
  const data = await ytService.search(q, { type, limit, offset });
  return ApiResponse.success(res, data.results || [], `Found ${data.total} results`);
});

const searchSuggestions = asyncHandler(async (req, res) => {
  const { q } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);
  const data = await ytService.searchSuggestions(q);
  return ApiResponse.success(res, data);
});

const getTrackById = asyncHandler(async (req, res) => {
  const track = await ytService.getTrackById(req.params.id);
  if (!track) return ApiResponse.error(res, "Track not found", 404);
  return ApiResponse.success(res, track);
});

const getLyrics = asyncHandler(async (req, res) => {
  const lyrics = await ytService.getLyrics(req.params.id);
  if (!lyrics) return ApiResponse.error(res, "Lyrics not found", 404);
  return ApiResponse.success(res, { lyrics });
});

const getAlbumById = asyncHandler(async (req, res) => {
  const album = await ytService.getAlbumById(req.params.id);
  if (!album) return ApiResponse.error(res, "Album not found", 404);
  return ApiResponse.success(res, album);
});

const getAlbumTracks = asyncHandler(async (req, res) => {
  const album = await ytService.getAlbumById(req.params.id);
  if (!album) return ApiResponse.error(res, "Album not found", 404);
  return ApiResponse.success(res, album.songs || []);
});

const getArtistById = asyncHandler(async (req, res) => {
  const artist = await ytService.getArtistById(req.params.id);
  if (!artist) return ApiResponse.error(res, "Artist not found", 404);
  return ApiResponse.success(res, artist);
});

const getArtistTopTracks = asyncHandler(async (req, res) => {
  const data = await ytService.getArtistTopTracks(req.params.id);
  return ApiResponse.success(res, data.results || []);
});

const getArtistAlbums = asyncHandler(async (req, res) => {
  const data = await ytService.getArtistAlbums(req.params.id);
  return ApiResponse.success(res, data.results || []);
});

const getPlaylistById = asyncHandler(async (req, res) => {
  const playlist = await ytService.getPlaylistById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);
  return ApiResponse.success(res, playlist);
});

const getPlaylistTracks = asyncHandler(async (req, res) => {
  const playlist = await ytService.getPlaylistById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);
  return ApiResponse.success(res, playlist.songs || []);
});

module.exports = {
  search,
  searchSuggestions,
  getTrackById,
  getLyrics,
  getAlbumById,
  getAlbumTracks,
  getArtistById,
  getArtistTopTracks,
  getArtistAlbums,
  getPlaylistById,
  getPlaylistTracks,
};