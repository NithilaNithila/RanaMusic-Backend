const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const Playlist = require("../models/Playlist");

const normalizeTracks = (tracks = []) =>
  tracks.map((t) => ({
    id: t.jamendoId,
    name: t.name,
    artist_name: t.artistName,
    image: t.albumImage,
    audio: t.audioUrl,
    duration: t.duration,
  }));

// GET /api/playlists  (current user's playlists)
const getMyPlaylists = asyncHandler(async (req, res) => {
  const playlists = await Playlist.find({ user: req.user._id }).sort({
    createdAt: -1,
  });
  const result = playlists.map((p) => ({
    ...p.toObject(),
    tracks: normalizeTracks(p.tracks),
  }));
  return ApiResponse.success(res, result);
});

// GET /api/playlists/:id
const getPlaylistById = asyncHandler(async (req, res) => {
  const playlist = await Playlist.findById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);

  const isOwner = playlist.user.toString() === req.user?._id?.toString();
  if (!playlist.isPublic && !isOwner) {
    return ApiResponse.error(res, "Not authorized to view this playlist", 403);
  }

  const result = {
    ...playlist.toObject(),
    tracks: normalizeTracks(playlist.tracks),
  };
  return ApiResponse.success(res, result);
});

// POST /api/playlists
const createPlaylist = asyncHandler(async (req, res) => {
  const { name, description, isPublic, coverImage } = req.body;
  if (!name) return ApiResponse.error(res, "Playlist name is required", 400);

  const playlist = await Playlist.create({
    user: req.user._id,
    name,
    description,
    isPublic,
    coverImage,
  });

  return ApiResponse.success(res, playlist, "Playlist created", 201);
});

// PUT /api/playlists/:id
const updatePlaylist = asyncHandler(async (req, res) => {
  const playlist = await Playlist.findById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);
  if (playlist.user.toString() !== req.user._id.toString()) {
    return ApiResponse.error(res, "Not authorized", 403);
  }

  const { name, description, isPublic, coverImage } = req.body;
  if (name !== undefined) playlist.name = name;
  if (description !== undefined) playlist.description = description;
  if (isPublic !== undefined) playlist.isPublic = isPublic;
  if (coverImage !== undefined) playlist.coverImage = coverImage;

  await playlist.save();
  const updated = {
    ...playlist.toObject(),
    tracks: normalizeTracks(playlist.tracks),
  };
  return ApiResponse.success(res, updated, "Playlist updated");
});

// DELETE /api/playlists/:id
const deletePlaylist = asyncHandler(async (req, res) => {
  const playlist = await Playlist.findById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);
  if (playlist.user.toString() !== req.user._id.toString()) {
    return ApiResponse.error(res, "Not authorized", 403);
  }

  await playlist.deleteOne();
  return ApiResponse.success(res, {}, "Playlist deleted");
});

// POST /api/playlists/:id/tracks
const addTrackToPlaylist = asyncHandler(async (req, res) => {
  const playlist = await Playlist.findById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);
  if (playlist.user.toString() !== req.user._id.toString()) {
    return ApiResponse.error(res, "Not authorized", 403);
  }

  const { jamendoId, name, artistName, albumImage, audioUrl, duration } =
    req.body;
  if (!jamendoId) return ApiResponse.error(res, "jamendoId is required", 400);

  const alreadyExists = playlist.tracks.some(
    (t) => t.jamendoId === jamendoId
  );
  if (alreadyExists) {
    return ApiResponse.error(res, "Track already in playlist", 409);
  }

  playlist.tracks.push({
    jamendoId,
    name,
    artistName,
    albumImage,
    audioUrl,
    duration,
  });
  await playlist.save();

  const result = {
    ...playlist.toObject(),
    tracks: normalizeTracks(playlist.tracks),
  };
  return ApiResponse.success(res, result, "Track added to playlist");
});

// DELETE /api/playlists/:id/tracks/:jamendoId
const removeTrackFromPlaylist = asyncHandler(async (req, res) => {
  const playlist = await Playlist.findById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);
  if (playlist.user.toString() !== req.user._id.toString()) {
    return ApiResponse.error(res, "Not authorized", 403);
  }

  playlist.tracks = playlist.tracks.filter(
    (t) => t.jamendoId !== req.params.jamendoId
  );
  await playlist.save();

  const result = {
    ...playlist.toObject(),
    tracks: normalizeTracks(playlist.tracks),
  };
  return ApiResponse.success(res, result, "Track removed from playlist");
});

module.exports = {
  getMyPlaylists,
  getPlaylistById,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
};
