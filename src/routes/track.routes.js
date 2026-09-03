const express = require("express");
const router = express.Router();
const {
  searchTracks,
  getPopularTracks,
  getTrackById,
  resolveTrack,
} = require("../controllers/track.controller");

router.get("/search", searchTracks);
router.get("/popular", getPopularTracks);
router.get("/resolve", resolveTrack);
router.get("/:id", getTrackById);

module.exports = router;
