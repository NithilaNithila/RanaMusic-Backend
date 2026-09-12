const express = require("express");
const router = express.Router();
const { getCatalogPlaylists } = require("../controllers/catalog.controller");
const { apiLimiter } = require("../middleware/rateLimiter.middleware");

// Home "Curated Playlists" feed (merged across providers, daily rotation).
router.get("/playlists", apiLimiter, getCatalogPlaylists);

module.exports = router;