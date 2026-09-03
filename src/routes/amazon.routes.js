const express = require("express");
const router = express.Router();
const amazon = require("../controllers/amazon.controller");

router.get("/search", amazon.search);

router.get("/tracks/:id", amazon.getTrackById);

router.get("/albums/:id", amazon.getAlbumById);
router.get("/albums/:id/tracks", amazon.getAlbumTracks);

router.get("/artists/:id", amazon.getArtistById);
router.get("/artists/:id/top-tracks", amazon.getArtistTopTracks);

router.get("/playlists/:id", amazon.getPlaylistById);
router.get("/playlists/:id/tracks", amazon.getPlaylistTracks);

module.exports = router;
