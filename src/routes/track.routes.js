const express = require("express");
const router = express.Router();
const {
  searchTracks,
  getPopularTracks,
  getTrackById,
} = require("../controllers/track.controller");

router.get("/search", searchTracks);
router.get("/popular", getPopularTracks);
router.get("/:id", getTrackById);

module.exports = router;
