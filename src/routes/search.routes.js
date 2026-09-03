const express = require("express");
const router = express.Router();
const { search } = require("../controllers/search.controller");

// Unified multi-provider search:
//   GET /api/search?q=...&type=track,album,artist,playlist&limit=20&offset=0
// Aggregates Saavn + Spotify + YouTube Music + Amazon Music per category and
// returns { tracks, albums, artists, playlists }.
router.get("/", search);

module.exports = router;