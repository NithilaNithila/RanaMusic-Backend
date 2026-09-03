const jwt = require("jsonwebtoken");
const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const User = require("../models/User");
const { getCache, setCache } = require("../services/cache.service");

// Explicitly restrict token verification to HS256 only. Without an explicit
// algorithm whitelist, jsonwebtoken will verify against whatever `alg` header
// a token presents (excluding "none"), which broadens the accepted signature
// algorithms. We sign with HS256, so hard-enforce it to narrow that surface.
const VERIFY_OPTIONS = { algorithms: ["HS256"] };

// Bind tokens to this service. Legacy tokens issued before these claims were
// added carry no iss/aud, so we enforce them only when the token includes the
// claim — new tokens are strictly bound, old ones stay valid until expiry.
const assertClaims = (decoded) => {
  const issuer = process.env.JWT_ISSUER || "rana-music";
  const audience = process.env.JWT_AUDIENCE || "rana-music-client";
  if (decoded.iss && decoded.iss !== issuer) return false;
  if (decoded.aud && decoded.aud !== audience) return false;
  return true;
};

// Cache authenticated users for 60s so repeated authenticated requests
// don't hit MongoDB on every single API call.
const userCacheKey = (id) => `auth:user:${id}`;
const USER_CACHE_TTL = 60;

// Resolves the authenticated user from the Bearer token into req.user when
// present and valid. Used by routes that are reachable both anonymously (e.g.
// viewing a public playlist) and by an authenticated owner (viewing their own
// private one). Never blocks; a missing/invalid token simply leaves req.user
// unset so the controller can apply its own authorization rules.
const optionalAuth = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, VERIFY_OPTIONS);
    if (!assertClaims(decoded)) return next();

    const cacheKey = userCacheKey(decoded.id);
    const cachedUser = getCache(cacheKey);
    if (cachedUser) {
      req.user = cachedUser;
      return next();
    }

    const user = await User.findById(decoded.id).select("-password").lean();
    if (!user) {
      return next();
    }

    setCache(cacheKey, user, USER_CACHE_TTL);
    req.user = user;
    next();
  } catch (err) {
    // Invalid/expired token on an optional-auth route is treated as anonymous.
    next();
  }
});

const protect = asyncHandler(async (req, res, next) => {
  let token;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }

  if (!token) {
    return ApiResponse.error(res, "Not authorized, no token provided", 401);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, VERIFY_OPTIONS);
    if (!assertClaims(decoded)) {
      return ApiResponse.error(res, "Not authorized, token invalid or expired", 401);
    }

    // 1. Try fast in-memory cache first (avoids a MongoDB round-trip per request)
    const cacheKey = userCacheKey(decoded.id);
    const cachedUser = getCache(cacheKey);
    if (cachedUser) {
      req.user = cachedUser;
      return next();
    }

    // 2. Cache miss -> load from DB
    const user = await User.findById(decoded.id).select("-password").lean();
    if (!user) {
      return ApiResponse.error(res, "Not authorized, user not found", 401);
    }

    setCache(cacheKey, user, USER_CACHE_TTL);
    req.user = user;
    next();
  } catch (err) {
    return ApiResponse.error(res, "Not authorized, token invalid or expired", 401);
  }
});

module.exports = { protect, optionalAuth, userCacheKey };
