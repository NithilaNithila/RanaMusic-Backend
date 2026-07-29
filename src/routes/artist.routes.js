const express = require("express");
const router = express.Router();
const {
  getArtists,
  searchArtists,
  getArtistById,
  getArtistAlbums,
  getArtistTracks,
} = require("../controllers/artist.controller");

router.get("/", getArtists);
router.get("/search", searchArtists);
router.get("/:id/albums", getArtistAlbums);
router.get("/:id/tracks", getArtistTracks);
router.get("/:id", getArtistById);

module.exports = router;
