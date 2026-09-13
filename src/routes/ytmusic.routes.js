const express = require("express");
const router = express.Router();
const asyncHandler = require("../utils/asyncHandler");
const yt = require("../controllers/ytmusic.controller");

// Multi-type search over the youtubei catalog (track/album/artist/playlist).
const search = require("../controllers/ytmusic.controller").search;
router.get("/search", asyncHandler(search));

// Live health of the ytmusic provider: enabled/breaker state, cookies
// configured, bot-check counter (grows when YT_COOKIES_B64 expires on a
// datacenter IP). Call this before blaming streaming when playback 403s.
router.get("/status", asyncHandler(yt.status));

// Gated diagnostics: ?p=<YT_DEBUG_TOKEN> runs the real --list-formats on this
// server (binary + cookies + client + proxy) to show what a hosted instance
// actually receives. Disabled unless YT_DEBUG_TOKEN is set.
router.get("/debug-formats/:id(\\w{11})", asyncHandler(yt.debugFormats));

// Gated refresh of the in-use cookies file: POST base64 cookies to replace the
// temp file in-place (no redeploy / env edit on ephemeral hosts). Same token
// gate as /debug-formats above.
router.post("/cookies", asyncHandler(yt.updateCookies));

// In-process yt-dlp audio stream for a YouTube Music videoId. Public (the
// client plays audio via an <audio> tag that can't attach Bearer headers), so
// it is guarded by the global rate limiter + a stricter per-IP stream limiter
// and a hard concurrency cap on spawned yt-dlp processes.
router.get("/songs/:id/stream", asyncHandler(yt.stream));

// Catalog detail from the youtubei browse endpoint (playlist = bare list id,
// album = MPREb_ browseId). Used by the search result cards when a catalog row
// is clicked; /tracks returns the playable song list, each song streaming
// through /songs/:id/stream above.
router.get("/playlists/:id", asyncHandler(yt.playlist));
router.get("/playlists/:id/tracks", asyncHandler(yt.playlistTracks));
router.get("/albums/:id", asyncHandler(yt.album));
router.get("/albums/:id/tracks", asyncHandler(yt.albumTracks));

module.exports = router;