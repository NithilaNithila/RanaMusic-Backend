const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const amazonWebConfig = require("../config/amazonWeb");
const amazonWebService = require("../services/amazonWeb.service");
const { makePlayable, enrichPlayable } = require("../services/search.service");

const status = asyncHandler(async (req, res) => {
  return ApiResponse.success(res, {
    enabled: amazonWebConfig.enabled,
    provider: "amazon-web (unofficial music.amazon.* skill endpoints)",
    note:
      "Amazon's own streams are DRM-locked (metadata only from the skill API); playable audio is resolved via the shared Saavn resolver, same as /api/search",
  });
});

const search = asyncHandler(async (req, res) => {
  const { q, type, limit, page, next } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);
  const data = await amazonWebService.search(q, { type, limit, page, next });
  const results = data.results || {};
  for (const key of Object.keys(results)) {
    if (Array.isArray(results[key])) results[key] = await enrichPlayable(results[key], key);
  }
  return ApiResponse.success(res, results, `Found ${data.total} results`);
});

const getTrackById = asyncHandler(async (req, res) => {
  const track = await amazonWebService.getTrackById(req.params.id);
  if (!track) return ApiResponse.error(res, "Track not found", 404);
  return ApiResponse.success(res, await makePlayable(track));
});

const getAlbumById = asyncHandler(async (req, res) => {
  const album = await amazonWebService.getAlbumById(req.params.id, req.query.region);
  if (!album) return ApiResponse.error(res, "Album not found", 404);
  album.songs = await enrichPlayable(album.songs, "track");
  return ApiResponse.success(res, album);
});

const getAlbumTracks = asyncHandler(async (req, res) => {
  const album = await amazonWebService.getAlbumById(req.params.id, req.query.region);
  if (!album) return ApiResponse.error(res, "Album not found", 404);
  const songs = await enrichPlayable(album.songs || [], "track");
  return ApiResponse.success(res, songs);
});

const getArtistById = asyncHandler(async (req, res) => {
  const data = await amazonWebService.getArtistById(req.params.id);
  if (!data) return ApiResponse.error(res, "Artist not found", 404);
  return ApiResponse.success(res, data.artist);
});

const getArtistTopTracks = asyncHandler(async (req, res) => {
  const { limit = 10 } = req.query;
  const data = await amazonWebService.getArtistById(req.params.id);
  if (!data) return ApiResponse.error(res, "Artist not found", 404);
  const count = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 25);
  const songs = await enrichPlayable(data.topSongs.slice(0, count), "track");
  return ApiResponse.success(res, songs);
});

const getPlaylistById = asyncHandler(async (req, res) => {
  const playlist = await amazonWebService.getPlaylistById(req.params.id, req.query.region);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);
  playlist.songs = await enrichPlayable(playlist.songs, "track");
  return ApiResponse.success(res, playlist);
});

const getPlaylistTracks = asyncHandler(async (req, res) => {
  const playlist = await amazonWebService.getPlaylistById(req.params.id, req.query.region);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);
  const songs = await enrichPlayable(playlist.songs || [], "track");
  return ApiResponse.success(res, songs);
});

const getCommunityPlaylistById = asyncHandler(async (req, res) => {
  const playlist = await amazonWebService.getCommunityPlaylistById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Community playlist not found", 404);
  playlist.songs = await enrichPlayable(playlist.songs, "track");
  return ApiResponse.success(res, playlist);
});

const getCommunityPlaylistTracks = asyncHandler(async (req, res) => {
  const playlist = await amazonWebService.getCommunityPlaylistById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Community playlist not found", 404);
  const songs = await enrichPlayable(playlist.songs || [], "track");
  return ApiResponse.success(res, songs);
});

module.exports = {
  status,
  search,
  getTrackById,
  getAlbumById,
  getAlbumTracks,
  getArtistById,
  getArtistTopTracks,
  getPlaylistById,
  getPlaylistTracks,
  getCommunityPlaylistById,
  getCommunityPlaylistTracks,
};