require("dotenv").config();

// Route DNS through Google to fix SRV resolution on networks with broken DNS
const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const mongoose = require("mongoose");
const app = require("./app");
const connectDB = require("./config/db");
const { logger } = require("./services/logger.service");

const PORT = process.env.PORT || 5000;
let server = null;
let shuttingDown = false;

// Fail fast at boot if required secrets are missing instead of surfacing
// confusing runtime errors on first authenticated request / db connect.
if (!process.env.MONGO_URI) {
  logger.fatal("MONGO_URI is required");
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  logger.fatal("JWT_SECRET is required");
  process.exit(1);
}

const start = async () => {
  await connectDB();
  server = app.listen(PORT, () => {
    logger.info({ port: PORT }, "server started");
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      logger.fatal({ port: PORT }, `Port ${PORT} is already in use`);
    } else {
      logger.fatal({ err: { message: err.message } }, "server socket error");
    }
    process.exit(1);
  });

  // Harden the HTTP server against slowloris / stalled-connection DoS and keep
  // keep-alive connections from lingering. These mirror common reverse-proxy
  // (Render/Railway/nginx) recommendations and only bound resource usage.
  // server.keepAliveTimeout must stay below any LB idle timeout so connections
  // aren't killed mid-response.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  // Give a full request (headers + body) a bounded window so a slow client
  // can't hold a socket open indefinitely.
  server.requestTimeout = 120000;

  const shutdown = (signal) => {
    if (shuttingDown) return; // guard against SIGTERM+SIGINT firing twice
    shuttingDown = true;
    logger.info({ signal }, "shutdown started, closing connections");

    // Stop accepting new connections immediately.
    server.close(() => {
      logger.info("HTTP server closed");
    });

    // Force-terminate remaining open keep-alive connections so the process
    // doesn't hang waiting for idle clients.
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }

    // Give in-flight work a bounded window, then hard-exit so a stuck
    // connection/query can't block a deploy or platform restart forever.
    const forceExit = setTimeout(() => {
      logger.error("shutdown timed out, forcing exit");
      process.exit(1);
    }, 10000);
    forceExit.unref();

    mongoose
      .disconnect()
      .then(() => {
        clearTimeout(forceExit);
        logger.info("MongoDB disconnected");
        process.exit(0);
      })
      .catch((err) => {
        logger.error({ err }, "error during MongoDB disconnect");
        process.exit(1);
      });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

// A hanging unhandled rejection usually means a promise chain left the event
// loop in an undefined state (unclosed DB connections, corrupted caches, half
// writes). Logging and continuing can mask the corruption; the platform
// (Render/PM2) restarts the process, so fail fast and let it be restarted.
const fatal = (label, err) => {
  logger.fatal({ label, err: { message: err?.message, stack: err?.stack, raw: String(err) } }, label);
  server?.close(() => {
    mongoose.disconnect().then(() => process.exit(1)).catch(() => process.exit(1));
  });
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on("unhandledRejection", (err) => fatal("Unhandled rejection", err));
process.on("uncaughtException", (err) => fatal("Uncaught exception", err));

// If listen() fails (e.g. EADDRINUSE) or connectDB throws outside its own
// handler, surface it and exit rather than leaving an unhandled rejection that
// could hang the process.
start().catch((err) => {
  logger.fatal({ err: { message: err?.message, stack: err?.stack } }, "server failed to start");
  process.exit(1);
});
