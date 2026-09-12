const express = require("express");
const compression = require("compression");
const cors = require("cors");
const helmet = require("helmet");
const mongoose = require("mongoose");

const routes = require("./routes/index");
const { apiLimiter, ytStreamLimiter, spotifyTokenLimiter } = require("./middleware/rateLimiter.middleware");
const { notFound, errorHandler } = require("./middleware/error.middleware");
const { requestLogger, redactUrl } = require("./middleware/requestLogger.middleware");
const { logger } = require("./services/logger.service");

const app = express();

// Trust the proxy hop count for the ACTUAL deployment topology so req.ip
// reflects real clients instead of the load balancer/router (rate limiting
// keys on req.ip). Default 1 hop (Render/Koyeb/Vercel put exactly one proxy in
// front); override with TRUST_PROXY (number of hops, "false"/"0" to disable)
// if the topology differs — the default is deliberately conservative and
// pinned rather than trusting everything.
let trustProxyValue = 1;
const trustProxyEnv = (process.env.TRUST_PROXY || "").trim();
if (trustProxyEnv === "false" || trustProxyEnv === "0") trustProxyValue = false;
else if (trustProxyEnv) {
  const n = Number(trustProxyEnv);
  trustProxyValue = Number.isNaN(n) ? trustProxyEnv : n;
}
app.set("trust proxy", trustProxyValue);
app.set("etag", "weak"); // enable ETags for conditional GETs (304 responses)

// X-Response-Time header is injected just before the response headers are
// written so it is actually delivered to clients (setting it inside the
// "finish" event would be a no-op because headers are already sent by then).
// The writeHead wrapper is defensive: it skips adding the header if headers
// have already been sent so it can never throw on multi-call scenarios (e.g.
// streaming or an explicit writeHead after headers were flushed).
// X-Response-Time header + slow request detection. Slow requests are logged
// with the pino logger at warn level, correlated by request id.
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  const writeHead = res.writeHead.bind(res);
  res.writeHead = (...args) => {
    // Second writeHead call (e.g. after err.headersSent handling in a
    // streaming route) would throw ERR_HTTP_HEADERS_SENT — make it a no-op.
    if (res.headersSent) return res;
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    res.setHeader("X-Response-Time", `${ms.toFixed(1)}ms`);
    return writeHead(...args);
  };
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (ms > 500) {
      logger.warn({ reqId: req.id, method: req.method, url: redactUrl(req.originalUrl), durationMs: Math.round(ms) }, "slow request");
    }
  });
  next();
});

// Structured per-request logging + request id correlation.
app.use(requestLogger);

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "https:"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "same-origin" },
  dnsPrefetchControl: true,

  frameguard: { action: "deny" },
  hidePoweredBy: true,
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  ieNoOpen: true,
  noSniff: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  xssFilter: true,
  permittedCrossDomainPolicies: { permittedPolicies: "none" },
}));

// Compression - compress responses > 1KB, skip already-compressed and audio
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    const type = res.getHeader("content-type") || "";
    if (/^audio\//.test(type)) return false;
    return compression.filter(req, res);
  },
}));

// CORS. Supports a single origin or a comma-separated list so multiple
// frontends (prod + staging) can be allowed without a redeploy.
// If CLIENT_URL is not set, allows same-origin/non-browser clients only.
const allowedOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// In production, fail loudly if CLIENT_URL is not configured to avoid
// accidentally leaving CORS wide open.
if (process.env.NODE_ENV === "production" && allowedOrigins.length === 0) {
  logger.fatal("CLIENT_URL must be set in production — CORS would be wide open");
  process.exit(1);
}

// Development: if no CLIENT_URL in non-production, allow local origins commonly used
const isDevelopment = process.env.NODE_ENV !== "production";
const devAllowedOrigins = isDevelopment
  ? ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173", "http://127.0.0.1:3000"]
  : [];

app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin / non-browser clients (curl, mobile) that send no
      // Origin header, and any explicitly allow-listed origin.
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      if (isDevelopment && devAllowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

// Body parsers
app.use(express.json({ limit: "10kb" }));
// extended:false uses the built-in querystring parser (flat keys only). The URL
// isn't needed for nested form bodies and it eliminates qs prototype-pollution
// attack surface. JSON is the only body format the API documents.
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

// Rate limiting. The global limiter applies to every /api request (streaming
// included — express-rate-limit counts once at request start, so long audio
// responses are safe). /ytmusic additionally gets a tighter limiter because
// every hit spawns a yt-dlp subprocess; a per-instance concurrency cap inside
// ytmusic.service bounds spawned processes regardless of limiter state.
app.use("/api", apiLimiter);
app.use("/api/ytmusic", ytStreamLimiter);
app.use("/api/spotify/token", spotifyTokenLimiter);

// Health check
app.get("/health", (req, res) => {
  const dbState = mongoose.connection.readyState;
  // readyState: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  res.status(dbState === 1 ? 200 : 503).json({
    status: dbState === 1 ? "ok" : "degraded",
    db: dbState === 1 ? "connected" : "disconnected",
  });
});

// Root API route - list available endpoints
app.get("/api", (req, res) => {
  res.json({
    success: true,
    message: "RanaMusic API",
    endpoints: {
      search: "/api/search?q=...",
      auth: "/api/auth/me (requires auth)",
      saavn: "/api/saavn/search?q=...",
      ytmusic: "/api/ytmusic/search?q=...",
      ytmusic_stream: "/api/ytmusic/songs/:id/stream",
      playlists: "/api/playlists",
      albums: "/api/albums",
      artists: "/api/artists",
      favorites: "/api/favorites",
      liked_songs: "/api/liked-songs",
    },
  });
});

app.use("/api", routes);

// 404 handler
app.use(notFound);

// Error handler
app.use(errorHandler);

module.exports = app;
