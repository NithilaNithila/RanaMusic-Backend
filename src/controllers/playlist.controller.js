const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const Playlist = require("../models/Playlist");
const PlaylistTrack = require("../models/PlaylistTrack");
const { LANGUAGES } = require("../config/languages");
const { getCache, setCache, delCache, makeCacheKey, cache } = require("../services/cache.service");

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeTracks = (tracks = []) =>
  tracks.map((t) => ({
    id: t.jamendoId,
    name: t.name,
    artist_name: t.artistName,
    image: t.albumImage,
    audio: t.audioUrl,
    duration: t.duration,
  }));

// Builds the public playlist shape from a Playlist doc and its (already sorted)
// track docs. `tracks` defaults to [] so callers that don't need the full track
// list (list views) still get a stable shape with track_count.
const mapPlaylist = (p, tracks = []) => {
  const normalized = normalizeTracks(tracks);
  const hasCover = String(p.coverImage || "").trim();
  return {
    ...p,
    track_count: tracks.length,
    tracks: normalized,
    coverImage: hasCover
      ? p.coverImage
      : (normalized.find((t) => t.image)?.image || ""),
  };
};

// Given an array of playlist docs, returns a Map<playlistIdString, tracks[]>.
// Issues ONE query (not N+1) for all tracks of all playlists.
const loadTracksForPlaylists = async (playlists) => {
  if (!playlists.length) return new Map();
  const ids = playlists.map((p) => p._id);
  const tracks = await PlaylistTrack.find({ playlist: { $in: ids } })
    .sort({ position: 1 })
    .lean();
  const map = new Map();
  for (const t of tracks) {
    const key = String(t.playlist);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  return map;
};

// Invalidate all playlist list-caches after any mutation so the next read
// returns fresh data (no stale public/all/user views).
const invalidatePlaylistCaches = () => {
  const keys = cache.keys().filter((k) => k.startsWith("playlists:"));
  for (const k of keys) cache.del(k);
};

// GET /api/playlists  (current user's playlists) - cached per user
const getMyPlaylists = asyncHandler(async (req, res) => {
  const key = makeCacheKey(`playlists:user:${req.user._id}`, {});
  const cached = getCache(key);
  if (cached) return ApiResponse.success(res, cached);

  const playlists = await Playlist.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .lean();

  const tracksByPlaylist = await loadTracksForPlaylists(playlists);
  const result = playlists.map((p) =>
    mapPlaylist(p, tracksByPlaylist.get(String(p._id)) || [])
  );

  setCache(key, result, 30);
  return ApiResponse.success(res, result);
});

// GET /api/playlists/:id  (cached per playlist, invalidated on mutation)
const getPlaylistById = asyncHandler(async (req, res) => {
  const playlist = await Playlist.findById(req.params.id).lean();
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);

  const isOwner = playlist.user.toString() === req.user?._id?.toString();
  if (!playlist.isPublic && !isOwner) {
    return ApiResponse.error(res, "Not authorized to view this playlist", 403);
  }

  const tracks = await PlaylistTrack.find({ playlist: playlist._id })
    .sort({ position: 1 })
    .lean();

  return ApiResponse.success(res, mapPlaylist(playlist, tracks));
});

// GET /api/playlists/public  (cached)
const getPublicPlaylists = asyncHandler(async (req, res) => {
  const { q, language, page = 1, limit = 12 } = req.query;

  const filter = { isPublic: true };
  if (q && q.trim()) {
    filter.name = { $regex: escapeRegex(q.trim()), $options: "i" };
  }
  if (language && LANGUAGES[language]) {
    filter.language = language;
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(60, Math.max(1, parseInt(limit, 10) || 12));

  // Cache non-search, non-filtered requests for 30s (fast path)
  const cacheable = !q && !language;
  let key;
  if (cacheable) {
    key = makeCacheKey("playlists:public", { page: pageNum, limit: limitNum });
    const cached = getCache(key);
    if (cached) return ApiResponse.success(res, cached);
  }

  const [playlists, total] = await Promise.all([
    Playlist.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
    Playlist.countDocuments(filter),
  ]);

  const tracksByPlaylist = await loadTracksForPlaylists(playlists);
  const result = playlists.map((p) =>
    mapPlaylist(p, tracksByPlaylist.get(String(p._id)) || [])
  );
  const payload = {
    results: result,
    total,
    page: pageNum,
    limit: limitNum,
    hasMore: pageNum * limitNum < total,
  };

  if (cacheable) setCache(key, payload, 30);
  return ApiResponse.success(res, payload);
});

// GET /api/playlists/all  (user's own + all public playlists) - cached
const getAllPlaylists = asyncHandler(async (req, res) => {
  const { q, language, page = 1, limit = 20 } = req.query;

  const filter = {};
  const hasUser = Boolean(req.user?._id);
  if (hasUser) {
    filter.$or = [{ user: req.user._id }, { isPublic: true }];
  } else {
    filter.isPublic = true;
  }

  if (q && q.trim()) {
    filter.name = { $regex: escapeRegex(q.trim()), $options: "i" };
  }
  if (language && LANGUAGES[language]) {
    filter.language = language;
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(60, Math.max(1, parseInt(limit, 10) || 20));

  // Cache non-search, non-filtered requests
  const cacheable = !q && !language;
  let key;
  if (cacheable) {
    const userBit = hasUser ? req.user._id : "anon";
    key = makeCacheKey("playlists:all", { user: userBit, page: pageNum, limit: limitNum });
    const cached = getCache(key);
    if (cached) return ApiResponse.success(res, cached);
  }

  const [playlists, total] = await Promise.all([
    Playlist.find(filter)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
    Playlist.countDocuments(filter),
  ]);

  const tracksByPlaylist = await loadTracksForPlaylists(playlists);
  const result = playlists.map((p) =>
    mapPlaylist(p, tracksByPlaylist.get(String(p._id)) || [])
  );
  const payload = {
    results: result,
    total,
    page: pageNum,
    limit: limitNum,
    hasMore: pageNum * limitNum < total,
  };

  if (cacheable) setCache(key, payload, 30);
  return ApiResponse.success(res, payload);
});

// POST /api/playlists
const createPlaylist = asyncHandler(async (req, res) => {
  const { name, description, isPublic, coverImage, language } = req.body;
  if (!name) return ApiResponse.error(res, "Playlist name is required", 400);

  const playlist = await Playlist.create({
    user: req.user._id,
    name,
    description,
    isPublic,
    coverImage,
    language,
  });

  delCache(makeCacheKey(`playlists:user:${req.user._id}`, {}));
  invalidatePlaylistCaches();
  return ApiResponse.success(res, mapPlaylist(playlist.toObject()), "Playlist created", 201);
});

// PUT /api/playlists/:id
const updatePlaylist = asyncHandler(async (req, res) => {
  const playlist = await Playlist.findById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);
  if (playlist.user.toString() !== req.user._id.toString()) {
    return ApiResponse.error(res, "Not authorized", 403);
  }

  const { name, description, isPublic, coverImage, language } = req.body;
  if (name !== undefined) playlist.name = name;
  if (description !== undefined) playlist.description = description;
  if (isPublic !== undefined) playlist.isPublic = isPublic;
  if (coverImage !== undefined) playlist.coverImage = coverImage;
  if (language !== undefined) playlist.language = language;

  await playlist.save();
  invalidatePlaylistCaches();
  return ApiResponse.success(res, mapPlaylist(playlist.toObject()), "Playlist updated");
});

// DELETE /api/playlists/:id
const deletePlaylist = asyncHandler(async (req, res) => {
  const playlist = await Playlist.findById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);
  if (playlist.user.toString() !== req.user._id.toString()) {
    return ApiResponse.error(res, "Not authorized", 403);
  }

  // Remove the playlist and all of its tracks atomically so a failure mid-way
  // can't orphan track documents. Falls back to sequential deletes when the
  // backing store doesn't support transactions (e.g. shared Atlas clusters).
  const session = await Playlist.startSession();
  try {
    await session.withTransaction(async () => {
      await PlaylistTrack.deleteMany({ playlist: playlist._id }, { session });
      await Playlist.deleteOne({ _id: playlist._id }, { session });
    });
  } catch (err) {
    if (!/Transaction numbers are only allowed on a replica set member/i.test(err?.message || "")) throw err;
    await PlaylistTrack.deleteMany({ playlist: playlist._id });
    await Playlist.deleteOne({ _id: playlist._id });
  } finally {
    await session.endSession();
  }

  invalidatePlaylistCaches();
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

  const session = await Playlist.startSession();
  try {
    const tracked = await session.withTransaction(async () => {
      const existing = await PlaylistTrack.findOne(
        { playlist: playlist._id, jamendoId },
        null,
        { session }
      );
      if (existing) {
        return { conflict: true };
      }

      const lastPosition = await PlaylistTrack.findOne(
        { playlist: playlist._id },
        { position: 1 },
        { session, sort: { position: -1 } }
      );
      const position = (lastPosition ? lastPosition.position : 0) + 1;

      await PlaylistTrack.create(
        [
          {
            playlist: playlist._id,
            jamendoId,
            position,
            name,
            artistName,
            albumImage,
            audioUrl,
            duration,
          },
        ],
        { session }
      );

      // Auto-set cover from first track's image if playlist has no cover yet.
      if (!playlist.coverImage && albumImage) {
        playlist.coverImage = albumImage;
        await playlist.save({ session });
      }
      return { conflict: false };
    });

    if (tracked.conflict) {
      return ApiResponse.error(res, "Track already in playlist", 409);
    }
  } catch (err) {
    if (!/Transaction numbers are only allowed on a replica set member/i.test(err?.message || "")) throw err;
    // Fallback for stores without transaction support: do the same work
    // non-atomically (a concurrent duplicate is unlikely at this scale).
    const already = await PlaylistTrack.findOne({ playlist: playlist._id, jamendoId });
    if (already) {
      return ApiResponse.error(res, "Track already in playlist", 409);
    }
    const lastPosition = await PlaylistTrack.findOne({ playlist: playlist._id }, { position: 1 }, { sort: { position: -1 } });
    const position = (lastPosition ? lastPosition.position : 0) + 1;
    await PlaylistTrack.create({ playlist: playlist._id, jamendoId, position, name, artistName, albumImage, audioUrl, duration });
    if (!playlist.coverImage && albumImage) {
      playlist.coverImage = albumImage;
      await playlist.save();
    }
  } finally {
    await session.endSession();
  }

  invalidatePlaylistCaches();
  const tracks = await PlaylistTrack.find({ playlist: playlist._id })
    .sort({ position: 1 })
    .lean();
  return ApiResponse.success(res, mapPlaylist(playlist.toObject(), tracks), "Track added to playlist");
});

// DELETE /api/playlists/:id/tracks/:jamendoId
const removeTrackFromPlaylist = asyncHandler(async (req, res) => {
  const playlist = await Playlist.findById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);
  if (playlist.user.toString() !== req.user._id.toString()) {
    return ApiResponse.error(res, "Not authorized", 403);
  }

  await PlaylistTrack.deleteOne({
    playlist: playlist._id,
    jamendoId: req.params.jamendoId,
  });

  invalidatePlaylistCaches();
  const tracks = await PlaylistTrack.find({ playlist: playlist._id })
    .sort({ position: 1 })
    .lean();
  return ApiResponse.success(res, mapPlaylist(playlist.toObject(), tracks), "Track removed from playlist");
});

module.exports = {
  getMyPlaylists,
  getPublicPlaylists,
  getAllPlaylists,
  getPlaylistById,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
};
