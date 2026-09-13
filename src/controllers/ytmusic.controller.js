const { pipeline } = require("node:stream");
const ApiResponse = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");
const ytService = require("../services/ytmusic.service");
const ytConfig = require("../config/ytmusic");

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const sendStreamError = (res, err, customStatus = 502) => {
  // Always set CORP headers, even on error responses, so the audio tag in the
  // client is never blocked by cross-origin isolation policies.
  try {
    if (!res.headersSent) {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
    }
  } catch (_) {}
  
  const status = err && err.status !== undefined ? err.status : customStatus;
  const message = err && err.message ? err.message : "Stream unavailable";
  return ApiResponse.error(res, message, status);
};

// Streams the raw audio bytes for a YouTube Music videoId. Not a JSON
// endpoint: pipes yt-dlp stdout to the client with the correct content type.
const stream = async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!VIDEO_ID_RE.test(id)) {
    return sendStreamError(res, new Error("Invalid video id"), 400);
  }
  if (!ytService.isEnabled()) {
    return sendStreamError(res, new Error("YouTube Music is disabled"), 503);
  }
  if (ytService.isBreakerOpen()) {
    // Breaker open — return 503 with CORP header so client doesn't hang
    return sendStreamError(res, new Error("Source temporarily unavailable"), 503);
  }

  let clientGone = false;
  let child = null;
  req.on("close", () => {
    clientGone = true;
    if (child && !res.writableEnded) {
      try {
        child.kill("SIGKILL");
      } catch (_) {
        // process already gone
      }
    }
  });

  let info;
  try {
    info = await ytService.getTrackInfo(id);
  } catch (err) {
    return sendStreamError(res, err);
  }
  if (clientGone || res.destroyed) return undefined;

  try {
    child = ytService.spawnStream(id);
  } catch (err) {
    return sendStreamError(res, err);
  }
  if (clientGone || res.destroyed) {
    try {
      child.kill("SIGKILL");
    } catch (_) {
      // process already gone
    }
    return undefined;
  }

  // CORP/COEP headers must be set before the first flushHeaders so the audio
  // stream is usable cross-origin from the client's <audio> element.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
  res.setHeader("Content-Type", info.contentType);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");

  res.status(200);
  res.flushHeaders();

  let firstByte = false;
  const firstByteTimer = setTimeout(() => {
    if (!firstByte && !res.writableEnded) {
      try {
        child.kill("SIGKILL");
      } catch (_) {
        // process already gone
      }
      try {
        res.destroy();
      } catch (_) {
        // socket already gone
      }
    }
  }, ytConfig.streamStartTimeoutMs);
  if (typeof firstByteTimer.unref === "function") firstByteTimer.unref();
  child.stdout.once("data", () => {
    firstByte = true;
    clearTimeout(firstByteTimer);
  });

  child.on("error", (err) => {
    if (!res.headersSent) sendStreamError(res, err);
    else if (!res.writableEnded) {
      try {
        res.destroy();
      } catch (_) {
        // socket already gone
      }
    }
  });
  child.on("close", (code) => {
    if (code !== 0 && code !== undefined && !res.writableEnded) {
      try {
        res.destroy();
      } catch (_) {
        // socket already gone
      }
    }
  });

  // pipeline ties child + response lifecycles together: an abort or error on
  // either side destroys the other, so no yt-dlp child survives a dead client
  // (or vice versa). Callback (not await) form avoids an unhandled rejection.
  pipeline(child.stdout, res, (err) => {
    if (err && !res.writableEnded) {
      try {
        res.destroy();
      } catch (_) {
        // socket already gone
      }
    }
  });

  return undefined;
};

const sendCatalogError = (res, err) => {
  const status = err && err.status ? err.status : 502;
  return ApiResponse.error(res, (err && err.message) || "Catalog unavailable", status);
};

const forCollection = (kind) => async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return ApiResponse.error(res, `Missing ${kind} id`, 400);
  if (!ytService.isEnabled()) {
    return ApiResponse.error(res, "YouTube Music search is disabled", 503);
  }
  if (ytService.isBreakerOpen()) {
    return ApiResponse.error(res, "Source temporarily unavailable", 503);
  }
  try {
    // Playlists are addressed by their bare list id (the "VL" prefix is
    // re-added) so the ids used in search rows work unchanged; albums keep
    // their MPREb_ browseId.
    const browseId = kind === "playlist" ? ytService.playlistBrowseId(id) : id;
    const detail = await ytService.getCollectionDetail(browseId);
    return ApiResponse.success(res, detail);
  } catch (err) {
    return sendCatalogError(res, err);
  }
};

const forCollectionTracks = (kind) => async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return ApiResponse.error(res, `Missing ${kind} id`, 400);
  if (!ytService.isEnabled()) {
    return ApiResponse.error(res, "YouTube Music search is disabled", 503);
  }
  if (ytService.isBreakerOpen()) {
    return ApiResponse.error(res, "Source temporarily unavailable", 503);
  }
  try {
    const browseId = kind === "playlist" ? ytService.playlistBrowseId(id) : id;
    const songs = await ytService.getCollectionTracks(browseId);
    return ApiResponse.success(res, songs);
  } catch (err) {
    return sendCatalogError(res, err);
  }
};

const playlist = forCollection("playlist");
const playlistTracks = forCollectionTracks("playlist");
const album = forCollection("album");
const albumTracks = forCollectionTracks("album");

// Multi-type search, mirroring the other providers. Namespace the per-type
// result key (results.track / .album / .artist / .playlist) exactly like the
// unified search expects, so /api/ytmusic/search and the merged page stay in
// sync.
const search = asyncHandler(async (req, res) => {
  const { q, type, limit, offset } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);
  const data = await ytService.search(q, { type, limit, offset });
  const key = String(type || "all").toLowerCase();
  const results = key === "all" || !data.results[key]
    ? data.results
    : { [key]: data.results[key] };
  return ApiResponse.success(res, results, `Found ${data.total} results`);
});

// Live status of the YouTube Music integration: enabled/breaker state, whether
// cookies are configured (the free datacenter-IP bypass), and a bot-check
// counter so expire cookies surface as a growing count instead of silent 403s.
const status = asyncHandler(async (req, res) => {
  const snapshot = ytService.getStatus();
  snapshot.binaryVersion = await ytService.getYtDlpVersion();
  return ApiResponse.success(res, snapshot, "YouTube Music status");
});

// Gated diagnostics: runs the REAL yt-dlp format listing ON this server using
// the packaged binary, the configured cookies, player client and proxy, then
// returns the raw --list-formats output. Enabled only when the query `p`
// matches YT_DEBUG_TOKEN (set the env var temporarily). Lets us see whether a
// hosted instance (Render) actually reaches the proxy / gets formats.
const debugFormats = asyncHandler(async (req, res) => {
  const token = process.env.YT_DEBUG_TOKEN || "";
  const id = String(req.params.id || "").trim();
  if (!token || req.query.p !== token) {
    return ApiResponse.error(res, "Not authorized", 403);
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return ApiResponse.error(res, "Invalid video id", 400);
  }
  const result = await ytService.debugFormats(id);
  const proxyProbe = await ytService.probeProxy();
  return ApiResponse.success(res, { ...result, proxyProbe }, "Format probe complete");
});

// Gated admin action: replace the in-use cookies file in-place (no redeploy, no
// env edit) from a base64 payload, then report the new fingerprint so it can be
// matched against a local cookies.txt. Same YT_DEBUG_TOKEN gate as diagnostics.
const updateCookies = asyncHandler(async (req, res) => {
  const token = process.env.YT_DEBUG_TOKEN || "";
  if (!token || (req.query.p || req.query.token) !== token) {
    return ApiResponse.error(res, "Not authorized", 403);
  }
  const b64 = String((req.body && (req.body.base64 || req.body.cookies)) || "").trim();
  if (!b64) return ApiResponse.error(res, "Missing 'base64' in body", 400);
  try {
    const fingerprint = ytService.setCookiesFromBase64(b64);
    return ApiResponse.success(res, { updated: true, cookies: fingerprint }, "Cookies updated");
  } catch (err) {
    return ApiResponse.error(res, (err && err.message) || "Update failed", (err && err.status) || 400);
  }
});

module.exports = {
  stream,
  search,
  status,
  debugFormats,
  updateCookies,
  playlist,
  playlistTracks,
  album,
  albumTracks,
};