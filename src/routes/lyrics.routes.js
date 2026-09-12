const express = require("express");
const router = express.Router();
const lyrics = require("../controllers/lyrics.controller");

// GET /api/lyrics?artist=&title=&source=saavn|lrclib|lyricsovh  (by metadata)
router.get("/", lyrics.getLyricsByTitle);

// GET /api/lyrics/:id?source=saavn  (by upstream song id)
router.get("/:id", lyrics.getLyrics);

module.exports = router;