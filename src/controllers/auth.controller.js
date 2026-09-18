const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
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
const { logger } = require("../services/logger.service");

const { sendPasswordResetEmail } = require("../services/email.service");
const { recordFailure, clearFailures, getLockRemaining } = require("../utils/loginProtection");

const RESET_EXPIRES_IN = "15m"; // reset tokens are deliberately short-lived

// Precomputed bcrypt hash of a random string, used so the "user not found"
// path performs a bcrypt compare identical in cost to a real password check.
// This closes the timing oracle that would otherwise let an attacker infer
// whether an email exists by measuring response latency.
const DUMMY_PASSWORD_HASH = "$2a$10$J3X1BgA8BbxGHHNmpZ0eV.drfeVydnJmJ/tcZNjvb2/aD33ZnV/f.";

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
  const token = generateToken(user._id, { v: user.tokenVersion || 0 });

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
  const normalizedEmail = String(email || "").toLowerCase().trim();

  // Check if this (email, IP) bucket is temporarily locked due to brute-force
  // attempts. Bucketing by IP means an attacker can't lock a victim's account
  // from a foreign address — only their own IP gets throttled.
  const lockRemaining = getLockRemaining(normalizedEmail, req.ip);
  if (lockRemaining) {
    return ApiResponse.error(
      res,
      `Too many failed attempts. Try again in ${lockRemaining} seconds.`,
      429
    );
  }

  const user = await User.findOne({ email: normalizedEmail }).select("+password");
  if (!user) {
    // Constant-time-ish: run an equal-cost bcrypt compare so a missing account
    // responds in the same time as a wrong password on an existing account.
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    recordFailure(normalizedEmail, req.ip);
    return ApiResponse.error(res, "Invalid email or password", 401);
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    recordFailure(normalizedEmail, req.ip);
    return ApiResponse.error(res, "Invalid email or password", 401);
  }

  // Successful login — clear any failed attempt counter for this account.
  clearFailures(normalizedEmail);

  const token = generateToken(user._id, { v: user.tokenVersion || 0 });

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
  const u = req.user;
  return ApiResponse.success(res, {
    id: u._id,
    username: u.username,
    email: u.email,
    avatarUrl: u.avatarUrl,
  });
});

// DELETE /api/auth/me
const deleteMe = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const playlistIds = await Playlist.find({ user: userId }).distinct("_id");

  // Prefer a single transaction so deletion is atomic. Falls back to
  // sequential deletes when the backing store (e.g. shared/free Atlas
  // clusters) doesn't support multi-document transactions.
  const session = await Playlist.startSession();
  try {
    await session.withTransaction(async () => {
      await PlaylistTrack.deleteMany({ playlist: { $in: playlistIds } }, { session });
      await Playlist.deleteMany({ user: userId }, { session });
      await Favorite.deleteMany({ user: userId }, { session });
      await History.deleteMany({ user: userId }, { session });
      await LikedSong.deleteMany({ user: userId }, { session });
      await User.deleteOne({ _id: userId }, { session });
    });
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
  } finally {
    await session.endSession();
  }

  // Drop the in-memory auth cache so the deleted account can't keep using
  // protected routes with an already-issued (still-valid) token.
  delCache(userCacheKey(userId));

  return ApiResponse.success(res, null, "Account deleted successfully");
});

// POST /api/auth/forgot-password
// Issues a short-lived, single-purpose reset token for the account matching
// `email` and delivers it via email. The response is deliberately uniform
// whether or not the account exists to prevent account enumeration.
const forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!email) return ApiResponse.error(res, "email is required", 400);

  const user = await User.findOne({ email }).select("_id");
  if (!user) {
    // Do not reveal whether an account exists (account-enumeration protection).
    return ApiResponse.success(res, {}, "If that account exists, a reset link has been sent");
  }

  // Generate a short-lived reset token and deliver via email.
  const resetToken = jwt.sign(
    {
      sub: user._id.toString(),
      type: "password-reset",
      jti: crypto.randomUUID(),
    },
    process.env.JWT_SECRET,
    { expiresIn: RESET_EXPIRES_IN, algorithm: "HS256" }
  );

  delCache(userCacheKey(user._id));

  // Deliver the reset link via email (falls back to console log in dev).
  try {
    await sendPasswordResetEmail({ to: email, resetToken, expiresIn: RESET_EXPIRES_IN });
  } catch (err) {
    // The uniform success response stays (account-enumeration protection), but
    // a delivery failure must be loud at error level: in production this means
    // the user is told "a reset link was sent" and never receives one. Mask the
    // recipient and never log the reset token itself.
    const masked = email.replace(/^(.{2})(.*)(@.*)$/, "$1***$3");
    logger.error({ err: { message: err.message }, to: masked }, "Failed to send password reset email");
  }

  return ApiResponse.success(res, {}, "If that account exists, a reset link has been sent");
});

// POST /api/auth/reset-password
const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return ApiResponse.error(res, "token and newPassword are required", 400);
  }
  if (String(newPassword).length < 8 || String(newPassword).length > 72) {
    return ApiResponse.error(res, "New password must be between 8 and 72 characters", 400);
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
  // Invalidate every outstanding session token: bump the tokenVersion so
  // middleware rejects all previously-issued JWTs.
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  delCache(userCacheKey(user._id));

  return ApiResponse.success(res, {}, "Password has been reset; please log in again");
});

module.exports = { register, login, getMe, deleteMe, forgotPassword, resetPassword };
