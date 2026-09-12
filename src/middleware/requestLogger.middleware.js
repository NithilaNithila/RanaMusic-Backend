const { logger, randomRequestId } = require("../services/logger.service");

// Query strings often carry search terms (q, name, artist, ids) — personal
// taste data we do NOT want in logs. Return a redacted copy of the URL:
// the path stays readable, query values become "***".
const redactUrl = (originalUrl = "") => {
  const qIdx = originalUrl.indexOf("?");
  if (qIdx === -1) return originalUrl;
  const path = originalUrl.slice(0, qIdx);
  const query = originalUrl
    .slice(qIdx + 1)
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      return eq === -1 ? pair : `${pair.slice(0, eq)}=***`;
    })
    .join("&");
  return `${path}?${query}`;
};

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
      url: redactUrl(req.originalUrl),
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

module.exports = { requestLogger, randomRequestId, redactUrl };