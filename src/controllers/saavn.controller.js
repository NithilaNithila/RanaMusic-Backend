const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const saavnService = require("../services/saavn.service");

const searchTracks = asyncHandler(async (req, res) => {
  const { q, page, limit } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);
  const data = await saavnService.searchTracks(q, { page, limit });
  return ApiResponse.success(res, data.results || [], `Found ${data.total} tracks`);
});

const searchAlbums = asyncHandler(async (req, res) => {
  const { q, page, limit } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);
  const data = await saavnService.searchAlbums(q, { page, limit });
  return ApiResponse.success(res, data.results || [], `Found ${data.total} albums`);
});

const searchArtists = asyncHandler(async (req, res) => {
  const { q, page, limit } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);
  const data = await saavnService.searchArtists(q, { page, limit });
  return ApiResponse.success(res, data.results || [], `Found ${data.total} artists`);
});

const searchPlaylists = asyncHandler(async (req, res) => {
  const { q, page, limit } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);
  const data = await saavnService.searchPlaylists(q, { page, limit });
  return ApiResponse.success(res, data.results || [], `Found ${data.total} playlists`);
});

const searchGlobal = asyncHandler(async (req, res) => {
  const { q, page, limit } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);
  const [tracks, albums, artists] = await Promise.allSettled([
    saavnService.searchTracks(q, { page, limit }),
    saavnService.searchAlbums(q, { page, limit }),
    saavnService.searchArtists(q, { page, limit }),
  ]);
  return ApiResponse.success(res, {
    tracks: tracks.status === "fulfilled" ? tracks.value.results || [] : [],
    albums: albums.status === "fulfilled" ? albums.value.results || [] : [],
    artists: artists.status === "fulfilled" ? artists.value.results || [] : [],
  });
});

const getTrackById = asyncHandler(async (req, res) => {
  const track = await saavnService.getTrackById(req.params.id);
  if (!track) return ApiResponse.error(res, "Track not found", 404);
  return ApiResponse.success(res, track);
});

const getTracks = asyncHandler(async (req, res) => {
  const { ids } = req.query;
  if (!ids) return ApiResponse.error(res, "Query param 'ids' is required", 400);
  const data = await saavnService.getTracks(ids);
  return ApiResponse.success(res, data.results || [], `Found ${data.total} tracks`);
});

const getTrackSuggestions = asyncHandler(async (req, res) => {
  const data = await saavnService.getTrackSuggestions(req.params.id);
  return ApiResponse.success(res, data.results || []);
});

const getAlbumById = asyncHandler(async (req, res) => {
  const album = await saavnService.getAlbumById(req.params.id);
  if (!album) return ApiResponse.error(res, "Album not found", 404);
  return ApiResponse.success(res, album);
});

const getAlbums = asyncHandler(async (req, res) => {
  const { ids } = req.query;
  if (!ids) return ApiResponse.error(res, "Query param 'ids' is required", 400);
  const data = await saavnService.getAlbums(ids);
  return ApiResponse.success(res, data.results || [], `Found ${data.total} albums`);
});

const getAlbumTracks = asyncHandler(async (req, res) => {
  const album = await saavnService.getAlbumById(req.params.id);
  if (!album) return ApiResponse.error(res, "Album not found", 404);
  return ApiResponse.success(res, album.songs || []);
});

const getArtistById = asyncHandler(async (req, res) => {
  const { songCount, albumCount } = req.query;
  const artist = await saavnService.getArtistById(req.params.id, { songCount, albumCount });
  if (!artist) return ApiResponse.error(res, "Artist not found", 404);
  return ApiResponse.success(res, artist);
});

const getArtists = asyncHandler(async (req, res) => {
  const { ids } = req.query;
  if (!ids) return ApiResponse.error(res, "Query param 'ids' is required", 400);
  const data = await saavnService.getArtists(ids);
  return ApiResponse.success(res, data.results || [], `Found ${data.total} artists`);
});

const getArtistSongs = asyncHandler(async (req, res) => {
  const { page, sortBy, sortOrder } = req.query;
  const data = await saavnService.getArtistSongs(req.params.id, { page, sortBy, sortOrder });
  return ApiResponse.success(res, data.results || []);
});

const getArtistAlbums = asyncHandler(async (req, res) => {
  const data = await saavnService.getArtistAlbums(req.params.id);
  return ApiResponse.success(res, data.results || []);
});

const getPlaylists = asyncHandler(async (req, res) => {
  const ids = req.query.ids || req.query.id || req.params.id;
  if (!ids) return ApiResponse.error(res, "Query param 'ids' is required", 400);
  const data = await saavnService.getPlaylists(ids);
  return ApiResponse.success(res, data.results || [], `Found ${data.total} playlists`);
});

const getPlaylistTracks = asyncHandler(async (req, res) => {
  const playlist = await saavnService.getPlaylistById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);
  // Saavn playlist songs carry full-length CDN audio natively.
  return ApiResponse.success(res, playlist.songs || []);
});

const getLyrics = asyncHandler(async (req, res) => {
  const lyrics = await saavnService.getLyrics(req.params.id);
  if (!lyrics) return ApiResponse.error(res, "Lyrics not found", 404);
  return ApiResponse.success(res, { lyrics });
});

module.exports = {
  searchTracks,
  searchAlbums,
  searchArtists,
  searchPlaylists,
  searchGlobal,
  getTrackById,
  getTracks,
  getTrackSuggestions,
  getAlbumById,
  getAlbums,
  getAlbumTracks,
  getArtistById,
  getArtists,
  getArtistSongs,
  getArtistAlbums,
  getPlaylists,
  getPlaylistTracks,
  getLyrics,
};
