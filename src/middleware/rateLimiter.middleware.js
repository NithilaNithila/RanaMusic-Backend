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

// Optional Amazon/YT streaming proxy use is heavy by nature — the limiter
// counts one token per request at request start (NOT per streaming byte), so
// long audio responses are safe. This is tighter than the global limiter
// because each hit spawns a subprocess on our side.
const ytStreamLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600, // ~40 streams/min per client
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ytstream:ip:${req.ip}`,
  message: {
    success: false,
    message: "Too many stream requests, please try again later.",
  },
});

// The Spotify /token endpoint is anonymous (the client needs a live Bearer
// token to call Spotify's API directly) and expensive-ish. It only needs to be
// fetched once an hour per client (tokens cache downstream), so a tight
// per-IP limiter stops it being abused as a free bespoke API while never
// interfering with normal playback.
const spotifyTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120, // a healthy client needs ~1 per hour; 120 is generous
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `spotify-token:ip:${req.ip}`,
  message: {
    success: false,
    message: "Too many token requests, please try again later.",
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

module.exports = { apiLimiter, authLimiter, userDataLimiter, ytStreamLimiter, spotifyTokenLimiter, keyGenerator };
