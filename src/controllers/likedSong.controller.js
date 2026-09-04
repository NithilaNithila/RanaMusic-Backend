const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const LikedSong = require("../models/LikedSong");
const { resolvePageOffset } = require("../utils/pagination");

const normalizeTrack = (t) => ({
  id: t.trackId,
  name: t.name,
  artist_name: t.artistName,
  image: t.image,
  audio: t.audioUrl,
  duration: t.duration,
  likedAt: t.createdAt,
});

// GET /api/liked-songs?page=&limit=&offset= (current user's liked songs,
// newest first). The response body stays { results, total } (backward
// compatible); pagination metadata is also exposed via response headers.
const LIKED_MAX = 500;

const getMyLikedSongs = asyncHandler(async (req, res) => {
  const pag = resolvePageOffset(req.query, LIKED_MAX);

  const liked = await LikedSong.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .skip(pag.offset)
    .limit(pag.limit)
    .lean();
  const result = liked.map(normalizeTrack);
  const total = await LikedSong.countDocuments({ user: req.user._id });

  res
    .set("X-Total-Count", String(total))
    .set("X-Page", String(pag.page))
    .set("X-Limit", String(pag.limit))
    .set("X-Has-More", String(pag.offset + pag.limit < total));
  return ApiResponse.success(res, { results: result, total });
});

// POST /api/liked-songs
// Body: { track: { id, name, artist_name, image, audio, duration } }
// Idempotent: liking an already-liked song is a no-op (returns 200).
const addLikedSong = asyncHandler(async (req, res) => {
  const { track } = req.body;
  if (!track || !track.id) {
    return ApiResponse.error(res, "track with an id is required", 400);
  }
  if (typeof track.id !== "string" || (track.name !== undefined && typeof track.name !== "string")) {
    return ApiResponse.error(res, "track.id and track.name must be strings", 400);
  }
  if (track.artist_name !== undefined && typeof track.artist_name !== "string") {
    return ApiResponse.error(res, "track.artist_name must be a string", 400);
  }
  if (track.image !== undefined && typeof track.image !== "string") {
    return ApiResponse.error(res, "track.image must be a string", 400);
  }
  if (track.audio !== undefined && typeof track.audio !== "string") {
    return ApiResponse.error(res, "track.audio must be a string", 400);
  }
  if (track.duration !== undefined && typeof track.duration !== "number") {
    return ApiResponse.error(res, "track.duration must be a number", 400);
  }

  const existing = await LikedSong.findOne({
    user: req.user._id,
    trackId: String(track.id),
  });
  if (existing) {
    return ApiResponse.success(res, normalizeTrack(existing), "Already liked");
  }

  const liked = await LikedSong.create({
    user: req.user._id,
    trackId: String(track.id),
    name: track.name,
    artistName: track.artist_name,
    image: track.image,
    audioUrl: track.audio,
    duration: track.duration,
  });

  return ApiResponse.success(res, normalizeTrack(liked), "Liked", 201);
});

// DELETE /api/liked-songs/:trackId
const removeLikedSong = asyncHandler(async (req, res) => {
  await LikedSong.findOneAndDelete({
    user: req.user._id,
    trackId: String(req.params.trackId),
  });

  return ApiResponse.success(res, {}, "Removed from liked songs");
});

module.exports = { getMyLikedSongs, addLikedSong, removeLikedSong };
