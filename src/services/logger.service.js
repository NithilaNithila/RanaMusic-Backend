const crypto = require("crypto");
const pino = require("pino");

// Structured logger. In production output JSON lines for log aggregation; in
// dev pretty-print for readability. Call child({ reqId }) or use the
// Express middleware (httpLogger) which attaches a per-request reqId so every
// log line for one request can be correlated.
const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  base: { service: "music-backend" },
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } },
});

const randomRequestId = () => crypto.randomBytes(8).toString("hex");

module.exports = { logger, randomRequestId };