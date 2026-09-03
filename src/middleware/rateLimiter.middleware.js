const rateLimit = require("express-rate-limit");

// General API limiter. Browsing 500 tracks / 171 artists easily exceeds a
// few hundred calls, so the dev ceiling is generous; upstream Saavn has its
// own throttling and the service caches responses.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
});

// Stricter limiter for auth routes to slow down brute force attempts
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip, // always key brute-force by IP
  message: {
    success: false,
    message: "Too many auth attempts, please try again later.",
  },
});

const keyGenerator =
  (ns) =>
  (req, res) => {
    // Key by the authenticated user id when present so a user's allowance is
    // not exhausted by their own actions nor shared unfairly across users on
    // the same NAT/IP. Unauthenticated requests fall back to IP.
    const uid = req.user?.id || req.user?._id?.toString();
    return uid
      ? Buffer.from(`${ns}:u:${uid}`).toString("base64url")
      : `${ns}:ip:${req.ip}`;
  };

// Per-user data-route limiter (playlists, favorites, likes). Applies AFTER the
// auth middleware so req.user is populated. Protects user-owned mutations from
// abuse while keeping the global catalog limiter broad.
const userDataLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 400, // ~27 calls/min, plenty for normal playlist/favorite/lyrics use
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyGenerator("user"),
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
});

module.exports = { apiLimiter, authLimiter, userDataLimiter, keyGenerator };
