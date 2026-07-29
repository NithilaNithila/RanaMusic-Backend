const express = require("express");
const router = express.Router();
const {
  getAlbums,
  searchAlbums,
  getAlbumById,
  getAlbumTracks,
} = require("../controllers/album.controller");

router.get("/", getAlbums);
router.get("/search", searchAlbums);
router.get("/:id/tracks", getAlbumTracks);
router.get("/:id", getAlbumById);

module.exports = router;
