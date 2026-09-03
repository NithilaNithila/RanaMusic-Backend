const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const User = require("../models/User");
const Playlist = require("../models/Playlist");
const PlaylistTrack = require("../models/PlaylistTrack");
const Favorite = require("../models/Favorite");
const History = require("../models/History");
const LikedSong = require("../models/LikedSong");
const generateToken = require("../utils/generateToken");
const { delCache } = require("../services/cache.service");
const { userCacheKey } = require("../middleware/auth.middleware");

const RESET_EXPIRES_IN = "15m"; // reset tokens are deliberately short-lived

// POST /api/auth/register
const register = asyncHandler(async (req, res) => {
  // Normalize inputs so the duplicate check matches the stored (normalized)
  // values and the DB never sees leading/trailing whitespace.
  const username = String(req.body.username || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = req.body.password;

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
  const playlistIds = await Playlist.find({ user: userId }).distinct("_id");

  try {
    // Prefer a single transaction so deletion is atomic. Falls back to
    // sequential deletes when the backing store (e.g. shared/free Atlas
    // clusters) doesn't support multi-document transactions.
    const session = await Playlist.startSession();
    await session.withTransaction(async () => {
      await PlaylistTrack.deleteMany({ playlist: { $in: playlistIds } }, { session });
      await Playlist.deleteMany({ user: userId }, { session });
      await Favorite.deleteMany({ user: userId }, { session });
      await History.deleteMany({ user: userId }, { session });
      await LikedSong.deleteMany({ user: userId }, { session });
      await User.deleteOne({ _id: userId }, { session });
    });
    await session.endSession();
  } catch (err) {
    const unsupported = /Transaction numbers are only allowed on a replica set member/i.test(err?.message);
    if (!unsupported) throw err;
    // Non-transactional fallback for stores without transaction support.
    await PlaylistTrack.deleteMany({ playlist: { $in: playlistIds } });
    await Promise.all([
      Playlist.deleteMany({ user: userId }),
      Favorite.deleteMany({ user: userId }),
      History.deleteMany({ user: userId }),
      LikedSong.deleteMany({ user: userId }),
    ]);
    await User.findByIdAndDelete(userId);
  }

  // Drop the in-memory auth cache so the deleted account can't keep using
  // protected routes with an already-issued (still-valid) token.
  delCache(userCacheKey(userId));

  return ApiResponse.success(res, null, "Account deleted successfully");
});

// POST /api/auth/forgot-password
// Issues a short-lived, single-purpose reset token for the account matching
// `email`. The token is NEVER returned in the response body: this backend has
// no mail transport, so the response is deliberately uniform whether or not the
// account exists. This removes both the account-enumeration oracle and the
// account-takeover vector (an unauthenticated caller cannot obtain a live reset
// token for someone else's account). To make password reset functional, deliver
// the token via an email service (or equivalent out-of-band channel).
const forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!email) return ApiResponse.error(res, "email is required", 400);

  const user = await User.findOne({ email }).select("_id");
  if (!user) {
    // Do not reveal whether an account exists (account-enumeration protection).
    return ApiResponse.success(res, {}, "If that account exists, a reset link has been issued");
  }

  // Generate the token but do not expose it to the caller. In production, a
  // mail transport should send it to `email` out-of-band.
  jwt.sign(
    {
      sub: user._id.toString(),
      type: "password-reset",
      jti: crypto.randomUUID(),
    },
    process.env.JWT_SECRET,
    { expiresIn: RESET_EXPIRES_IN, algorithm: "HS256" }
  );

  delCache(userCacheKey(user._id));
  return ApiResponse.success(res, {}, "If that account exists, a reset link has been issued");
});

// POST /api/auth/reset-password
const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return ApiResponse.error(res, "token and newPassword are required", 400);
  }
  if (String(newPassword).length < 6 || String(newPassword).length > 72) {
    return ApiResponse.error(res, "New password must be between 6 and 72 characters", 400);
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    return ApiResponse.error(res, "Reset token is invalid or has expired", 400);
  }
  if (payload.type !== "password-reset" || !payload.sub) {
    return ApiResponse.error(res, "Reset token is invalid or has expired", 400);
  }

  const user = await User.findById(payload.sub).select("+password");
  if (!user) return ApiResponse.error(res, "User not found", 404);

  user.password = newPassword;
  await user.save();
  delCache(userCacheKey(user._id));

  return ApiResponse.success(res, {}, "Password has been reset; please log in again");
});

module.exports = { register, login, getMe, deleteMe, forgotPassword, resetPassword };
