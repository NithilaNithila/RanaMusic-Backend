const ApiResponse = require("../utils/apiResponse");
const { logger } = require("../services/logger.service");

// 404 handler - place after all routes
const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};

// Central error handler - place last
const errorHandler = (err, req, res, next) => {
  // Streaming routes may already have sent headers (and possibly bytes) when a
  // relayed spawn error arrives. We can't send a JSON error at that point —
  // just drop the connection instead of double-sending and destroying it
  // mid-error-handling.
  if (res.headersSent) {
    if (typeof res.destroy === "function") {
      try {
        res.destroy();
      } catch (_) {
        // socket already gone
      }
    }
    return;
  }

  // Custom upstream errors (UpstreamError, YtUpstreamError, AmazonError,
  // SaavnUnavailableError) carry .status; use it so 502/429/etc. from
  // providers are surfaced instead of being flattened to a generic 500.
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || "Server Error";

  // Provider 5xx failures — and 0 (upstream unreachable / broken payloads,
  // e.g. SaavnUnavailableError) — mean the upstream is down/broken, not our
  // own server error. Surface them as 502 so clients can tell the difference
  // from a genuine 500 crash.
  if (err.status !== undefined && (err.status === 0 || err.status >= 500)) {
    statusCode = 502;
    message = "Upstream service error";
  }

  // Mongoose bad ObjectId
  if (err.name === "CastError") {
    statusCode = 400;
    message = "Invalid value provided";
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    statusCode = 409;
    message = "Duplicate value provided";
  }

  // Mongoose validation error
  if (err.name === "ValidationError") {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(", ");
  }

  // Upstream API errors (axios) - surface correct status instead of 500
  if (err.isAxiosError) {
    const upstreamStatus = err.response?.status;
    if (upstreamStatus === 404) {
      statusCode = 404;
      message = "Resource not found";
    } else if (upstreamStatus && upstreamStatus >= 500) {
      statusCode = 502;
      message = "Upstream service error";
    } else if (upstreamStatus) {
      statusCode = upstreamStatus;
      message = "Upstream request failed";
    } else {
      statusCode = 502;
      message = "Upstream service unreachable";
    }
  }

  // Structured, correlation-friendly logging (bound to the request id). The
  // stack trace can leak internal file paths / module layout, so it is only
  // logged in development. The client-facing message/status never changes.
  const log = logger.child({ reqId: req.id || "n/a", status: statusCode, path: req.originalUrl, method: req.method, name: err.name || "Error" });
  // Upstream detail (kept out of the client response) is still logged here so
  // the root cause isn't lost in production.
  const base = { message: err.message, name: err.name || "Error" };
  if (err.detail) base.detail = err.detail;
  const logged = process.env.NODE_ENV === "development"
    ? { err: { ...base, stack: err.stack } }
    : { err: base };
  log.error(logged, message);

  return ApiResponse.error(
    res,
    message,
    statusCode
  );
};

module.exports = { notFound, errorHandler };
