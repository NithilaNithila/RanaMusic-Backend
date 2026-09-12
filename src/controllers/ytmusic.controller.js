const { pipeline } = require("node:stream");
const ApiResponse = require("../utils/apiResponse");
const asyncHandler = require("../utils/asyncHandler");
const ytService = require("../services/ytmusic.service");
const ytConfig = require("../config/ytmusic");

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const sendStreamError = (res, err) => {
  if (res.headersSent) {
    try {
      res.destroy();
    } catch (_) {
      // socket already gone
    }
    return undefined;
  }
  const status = err && err.status ? err.status : 502;
  return ApiResponse.error(res, (err && err.message) || "Stream unavailable", status);
};

// Streams the raw audio bytes for a YouTube Music videoId. Not a JSON
// endpoint: pipes yt-dlp stdout to the client with the correct content type.
const stream = async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!VIDEO_ID_RE.test(id)) {
    return ApiResponse.error(res, "Invalid video id", 400);
  }
  if (!ytService.isEnabled()) {
    return ApiResponse.error(res, "YouTube Music streaming is disabled", 503);
  }
  if (ytService.isBreakerOpen()) {
    return ApiResponse.error(res, "Source temporarily unavailable", 503);
  }

  // Flag first so a client that detaches DURING the multi-second info probe is
  // detected the moment the await resolves — closing the kill-race window
  // where a child could otherwise be spawned for a socket that is already gone.
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
  // Client detached while the probe ran — don't pay for a stream nobody
  // consumes.
  if (clientGone || res.destroyed) return undefined;

  try {
    child = ytService.spawnStream(id);
  } catch (err) {
    return sendStreamError(res, err);
  }
  // Re-check after spawn; a close may have raced the spawn.
  if (clientGone || res.destroyed) {
    try {
      child.kill("SIGKILL");
    } catch (_) {
      // process already gone
    }
    return undefined;
  }

  res.status(200);
  res.setHeader("Content-Type", info.contentType);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // The <audio> element loads the stream cross-origin (frontend :5173 ->
  // backend :5000) with a no-cors fetch. The global helmet middleware sets
  // Cross-Origin-Resource-Policy: same-origin, which makes Chrome refuse the
  // media load entirely (silent player, stream still served fine to curl).
  // Media streams opt out: the bytes are public audio, not user data.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  // Commit the 200 immediately so the client sees a started response instead
  // of waiting on yt-dlp to begin producing bytes.
  res.flushHeaders();

  // First-byte budget: if yt-dlp produces no audio within
  // streamStartTimeoutMs (bot-check, DNS blackhole, throttled format), kill
  // the child and the socket rather than leaving both open indefinitely.
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

module.exports = {
  stream,
  search,
  playlist,
  playlistTracks,
  album,
  albumTracks,
};