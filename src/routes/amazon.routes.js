const express = require("express");
const router = express.Router();
const ApiResponse = require("../utils/apiResponse");
const amazon = require("../controllers/amazon.controller");
const amazonPlayback = require("../controllers/amazonPlayback.controller");
const amazonWeb = require("../controllers/amazonWeb.controller");
const amazonWebConfig = require("../config/amazonWeb");

router.get("/search", amazon.search);

router.get("/tracks/:id", amazon.getTrackById);

router.get("/albums/:id", amazon.getAlbumById);
router.get("/albums/:id/tracks", amazon.getAlbumTracks);

router.get("/artists/:id", amazon.getArtistById);
router.get("/artists/:id/top-tracks", amazon.getArtistTopTracks);

router.get("/playlists/:id", amazon.getPlaylistById);
router.get("/playlists/:id/tracks", amazon.getPlaylistTracks);

// ── playback (official /v1/playback/* behind the mirror) ────────────────
// The mirror owns LWA auth + the X-Amzn-Audio-* device headers; these routes
// forward the official request/response shapes 1:1 so the frontend consumes
// Amazon's own contract.
router.post("/playback/sessions", amazonPlayback.createSession);
router.get("/playback/sessions/active", amazonPlayback.activeSessions);

router.get("/playback/sessions/:sessionId/current", amazonPlayback.currentTrack);
router.get("/playback/sessions/:sessionId/next", amazonPlayback.nextTracks);
router.get("/playback/sessions/:sessionId/previous", amazonPlayback.previousTracks);
router.get("/playback/sessions/:sessionId/queue", amazonPlayback.queue);
router.get("/playback/sessions/:sessionId/entities/:entityReferenceId", amazonPlayback.restoreSession);

router.post("/playback/sessions/:sessionId/queue/next", amazonPlayback.queueNext);
router.post("/playback/sessions/:sessionId/queue/last", amazonPlayback.queueLast);
router.put("/playback/sessions/:sessionId/loop", amazonPlayback.setLoop);
router.put("/playback/sessions/:sessionId/shuffle", amazonPlayback.setShuffle);

router.post("/playback/event", amazonPlayback.reportEvent);
router.post("/playback/events", amazonPlayback.reportEvents);

// ── web scraper (unofficial music.amazon.* skill endpoints) ──────────
// Real-world catalog + metadata without LWA approval (anonymous, no
// cookies). Mounted under /web so it never shadows the mirror-backed
// routes above. Disable globally via AMZN_WEB_ENABLED=false.
const webEnabled = (req, res, next) => {
  if (!amazonWebConfig.enabled) {
    return ApiResponse.error(res, "Amazon web scraper disabled", 503);
  }
  return next();
};

router.get("/web/status", amazonWeb.status);
router.use("/web", webEnabled);
router.get("/web/search", amazonWeb.search);

router.get("/web/tracks/:id", amazonWeb.getTrackById);

router.get("/web/albums/:id", amazonWeb.getAlbumById);
router.get("/web/albums/:id/tracks", amazonWeb.getAlbumTracks);

router.get("/web/artists/:id", amazonWeb.getArtistById);
router.get("/web/artists/:id/top-tracks", amazonWeb.getArtistTopTracks);

router.get("/web/playlists/:id", amazonWeb.getPlaylistById);
router.get("/web/playlists/:id/tracks", amazonWeb.getPlaylistTracks);

router.get("/web/community-playlists/:id", amazonWeb.getCommunityPlaylistById);
router.get("/web/community-playlists/:id/tracks", amazonWeb.getCommunityPlaylistTracks);

module.exports = router;
