const express = require("express");
const router = express.Router();
const {
  getAlbums,
  searchAlbums,
  getAlbumById,
  getAlbumTracks,
} = require("../controllers/album.controller");
const { guardId } = require("../utils/guardId");

router.get("/", getAlbums);
router.get("/search", searchAlbums);
router.get("/:id/tracks", guardId("id", "album"), getAlbumTracks);
router.get("/:id", guardId("id", "album"), getAlbumById);

module.exports = router;
