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

const getArtistById = asyncHandler(async (req, res) => {
  const { songCount, albumCount } = req.query;
  const artist = await saavnService.getArtistById(req.params.id, { songCount, albumCount });
  if (!artist) return ApiResponse.error(res, "Artist not found", 404);
  return ApiResponse.success(res, artist);
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

const getLyrics = asyncHandler(async (req, res) => {
  const lyrics = await saavnService.getLyrics(req.params.id);
  if (!lyrics) return ApiResponse.error(res, "Lyrics not found", 404);
  return ApiResponse.success(res, { lyrics });
});

module.exports = {
  searchTracks,
  searchAlbums,
  searchArtists,
  searchGlobal,
  getTrackById,
  getAlbumById,
  getAlbumTracks,
  getArtistById,
  getArtistSongs,
  getArtistAlbums,
  getLyrics,
};
