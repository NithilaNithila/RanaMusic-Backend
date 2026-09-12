const express = require("express");
const router = express.Router();
const spotify = require("../controllers/spotify.controller");

router.get("/search", spotify.search);

// Live anonymous Spotify Bearer token (~1h) for direct Spotify API calls.
router.get("/token", spotify.getToken);

// Upstream health/uptime probe.
router.get("/health", spotify.getHealth);

router.get("/tracks/:id", spotify.getTrackById);

// Full-length playable audio for a Spotify track (auto-resolved via Saavn/YT).
router.get("/tracks/:id/stream", spotify.getTrackStream);

router.get("/albums/:id", spotify.getAlbumById);
router.get("/albums/:id/tracks", spotify.getAlbumTracks);

router.get("/artists/:id", spotify.getArtistById);
router.get("/artists/:id/top-tracks", spotify.getArtistTopTracks);
router.get("/artists/:id/albums", spotify.getArtistAlbums);

router.get("/playlists/:id", spotify.getPlaylistById);
router.get("/playlists/:id/tracks", spotify.getPlaylistTracks);

module.exports = router;