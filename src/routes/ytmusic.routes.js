const express = require("express");
const router = express.Router();
const ytmusic = require("../controllers/ytmusic.controller");
const { guardId } = require("../utils/guardId");

router.get("/search", ytmusic.search);

router.get("/albums/:id", guardId("id", "album"), ytmusic.getAlbumById);
router.get("/albums/:id/tracks", guardId("id", "album"), ytmusic.getAlbumTracks);

router.get("/playlists/:id", guardId("id", "playlist"), ytmusic.getPlaylistById);
router.get("/playlists/:id/tracks", guardId("id", "playlist"), ytmusic.getPlaylistTracks);

module.exports = router;