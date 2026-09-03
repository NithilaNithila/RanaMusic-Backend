const { logger, randomRequestId } = require("../services/logger.service");

// Attaches a per-request id (used for correlating log lines) and logs a single
// structured line per request when it finishes. If an authenticated user is
// present (protect/optionalAuth populated req.user before this? no — auth runs
// later), we still capture their id from a JWT-preload; otherwise fall back to
// the anonymous id, then enrich on 'finish' if req.user was populated.
const requestLogger = (req, res, next) => {
  req.id = randomRequestId();
  const start = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const log = logger.child({ reqId: req.id });
    const fields = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs,
      userId: req.user?._id?.toString() || undefined,
      ip: req.ip,
    };
    if (res.statusCode >= 500) log.error({ ...fields }, "request errored");
    else if (res.statusCode >= 400) log.warn({ ...fields }, "request client error");
    else log.info(fields, "request complete");
  });

  next();
};

module.exports = { requestLogger, randomRequestId };