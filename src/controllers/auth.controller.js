const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const User = require("../models/User");
const Playlist = require("../models/Playlist");
const Favorite = require("../models/Favorite");
const History = require("../models/History");
const generateToken = require("../utils/generateToken");

// POST /api/auth/register
const register = asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;

  const existingUser = await User.findOne({ $or: [{ email }, { username }] });
  if (existingUser) {
    return ApiResponse.error(res, "Username or email already in use", 409);
  }

  const user = await User.create({ username, email, password });
  const token = generateToken(user._id);

  return ApiResponse.success(
    res,
    {
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
      },
      token,
    },
    "Registered successfully",
    201
  );
});

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select("+password");
  if (!user) return ApiResponse.error(res, "Invalid email or password", 401);

  const isMatch = await user.comparePassword(password);
  if (!isMatch) return ApiResponse.error(res, "Invalid email or password", 401);

  const token = generateToken(user._id);

  return ApiResponse.success(res, {
    user: {
      id: user._id,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatarUrl,
    },
    token,
  }, "Logged in successfully");
});

// GET /api/auth/me
const getMe = asyncHandler(async (req, res) => {
  return ApiResponse.success(res, req.user);
});

// DELETE /api/auth/me
const deleteMe = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  await Promise.all([
    Playlist.deleteMany({ user: userId }),
    Favorite.deleteMany({ user: userId }),
    History.deleteMany({ user: userId }),
  ]);
  await User.findByIdAndDelete(userId);

  return ApiResponse.success(res, null, "Account deleted successfully");
});

module.exports = { register, login, getMe, deleteMe };
