const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const User = require("../models/User");
const History = require("../models/History");
const { getCache, setCache, delCache, makeCacheKey } = require("../services/cache.service");

const AVATAR_URL_RE = /^https?:\/\/.+/i;

// PUT /api/users/me
const updateProfile = asyncHandler(async (req, res) => {
  const { username, avatarUrl } = req.body;
  const user = await User.findById(req.user._id);

  if (username !== undefined) {
    const clean = String(username).trim();
    if (clean.length < 3 || clean.length > 30) {
      return ApiResponse.error(res, "Username must be between 3 and 30 characters", 400);
    }
    user.username = clean;
  }

  if (avatarUrl !== undefined) {
    // avatarUrl may be cleared with an empty string; otherwise it must be a URL.
    if (avatarUrl !== "" && !AVATAR_URL_RE.test(String(avatarUrl))) {
      return ApiResponse.error(res, "avatarUrl must be a valid http(s) URL", 400);
    }
    user.avatarUrl = avatarUrl;
  }

  try {
    await user.save();
  } catch (err) {
    // Duplicate username surfaces as a clean 409 instead of a generic 500.
    if (err && err.code === 11000) {
      return ApiResponse.error(res, "Username already in use", 409);
    }
    throw err;
  }
  // Invalidate cached auth user so future requests see the new profile
  delCache(`auth:user:${req.user._id}`);
  return ApiResponse.success(res, user, "Profile updated");
});

// GET /api/users/me/history  (cached 30s)
const getHistory = asyncHandler(async (req, res) => {
  const key = makeCacheKey(`history:user:${req.user._id}`, {});
  const cached = getCache(key);
  if (cached) return ApiResponse.success(res, cached);

  const history = await History.find({ user: req.user._id })
    .sort({ playedAt: -1 })
    .limit(50)
    .lean();

  setCache(key, history, 30);
  return ApiResponse.success(res, history);
});

// POST /api/users/me/history
const addHistoryEntry = asyncHandler(async (req, res) => {
  const { jamendoId, name, artistName, albumImage } = req.body;
  if (!jamendoId) return ApiResponse.error(res, "jamendoId is required", 400);

  const entry = await History.create({
    user: req.user._id,
    jamendoId,
    name,
    artistName,
    albumImage,
  });

  const KEEP = 100;
  const threshold = await History.find({ user: req.user._id })
    .sort({ playedAt: -1, _id: -1 }) // _id tiebreaker keeps pruning deterministic
    .skip(KEEP - 1)
    .limit(1)
    .select("playedAt")
    .lean();
  if (threshold.length) {
    await History.deleteMany({
      user: req.user._id,
      playedAt: { $lt: threshold[0].playedAt },
    });
  }

  delCache(makeCacheKey(`history:user:${req.user._id}`, {}));
  return ApiResponse.success(res, entry, "History recorded", 201);
});

// PUT /api/users/me/password
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return ApiResponse.error(res, "currentPassword and newPassword are required", 400);
  }
  if (String(newPassword).length < 8 || String(newPassword).length > 72) {
    return ApiResponse.error(res, "New password must be between 8 and 72 characters", 400);
  }

  const user = await User.findById(req.user._id).select("+password");
  if (!user) return ApiResponse.error(res, "User not found", 404);

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    return ApiResponse.error(res, "Current password is incorrect", 401);
  }

  user.password = newPassword;
  // Bump tokenVersion so every previously-issued JWT is rejected by the auth
  // middleware — a stolen pre-change token dies immediately, no client logout
  // required.
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  // Force the next request to re-authenticate; revoke the cached session so a
  // stolen pre-change token can't keep using cached identity.
  delCache(`auth:user:${req.user._id}`);

  return ApiResponse.success(res, {}, "Password changed successfully");
});

module.exports = { updateProfile, getHistory, addHistoryEntry, changePassword };