const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const User = require("../models/User");
const History = require("../models/History");

// PUT /api/users/me
const updateProfile = asyncHandler(async (req, res) => {
  const { username, avatarUrl } = req.body;
  const user = await User.findById(req.user._id);

  if (username !== undefined) user.username = username;
  if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;

  await user.save();
  return ApiResponse.success(res, user, "Profile updated");
});

// GET /api/users/me/history
const getHistory = asyncHandler(async (req, res) => {
  const history = await History.find({ user: req.user._id })
    .sort({ playedAt: -1 })
    .limit(50);
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
  const overflow = await History.find({ user: req.user._id })
    .sort({ playedAt: -1 })
    .skip(KEEP)
    .select("_id");
  if (overflow.length) {
    await History.deleteMany({ _id: { $in: overflow.map((o) => o._id) } });
  }

  return ApiResponse.success(res, entry, "History recorded", 201);
});

module.exports = { updateProfile, getHistory, addHistoryEntry };
