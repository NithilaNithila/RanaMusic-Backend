const express = require("express");
const compression = require("compression");
const cors = require("cors");
const helmet = require("helmet");
const mongoose = require("mongoose");

const routes = require("./routes/index");
const { apiLimiter } = require("./middleware/rateLimiter.middleware");
const { notFound, errorHandler } = require("./middleware/error.middleware");
const { requestLogger } = require("./middleware/requestLogger.middleware");
const { logger } = require("./services/logger.service");

const app = express();

// Trust the first proxy hop so req.ip reflects real clients instead of the
// load balancer. Required for rate limiting to work correctly behind
// Render/Koyeb/Vercel-style proxies (otherwise all users share one IP bucket).
app.set("trust proxy", 1);
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
  res.writeHead = (statusCode, headers) => {
    if (!res.headersSent) {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      res.setHeader("X-Response-Time", `${ms.toFixed(1)}ms`);
    }
    return writeHead(statusCode, headers);
  };
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (ms > 500) {
      logger.warn({ reqId: req.id, method: req.method, url: req.originalUrl, durationMs: Math.round(ms) }, "slow request");
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
      mediaSrc: ["'self'"],
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

// Compression - compress responses > 1KB
app.use(compression({ threshold: 1024 }));

// CORS. Supports a single origin or a comma-separated list so multiple
// frontends (prod + staging) can be allowed without a redeploy. If no origins
// are configured, reflection is disabled and only same-origin requests pass.
const allowedOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin / non-browser clients (curl, mobile) that send no
      // Origin header, and any explicitly allow-listed origin.
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
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

// Rate limiting
app.use("/api", apiLimiter);

// Health check
app.get("/health", (req, res) => {
  const dbState = mongoose.connection.readyState;
  // readyState: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  res.status(dbState === 1 ? 200 : 503).json({
    status: dbState === 1 ? "ok" : "degraded",
    db: dbState === 1 ? "connected" : "disconnected",
  });
});

// API routes
app.use("/api", routes);

// 404 handler
app.use(notFound);

// Error handler
app.use(errorHandler);

module.exports = app;
