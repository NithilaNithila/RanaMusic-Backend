const express = require("express");
const router = express.Router();
const spotify = require("../controllers/spotify.controller");

router.get("/search", spotify.search);

router.get("/tracks/:id", spotify.getTrackById);

router.get("/albums/:id", spotify.getAlbumById);
router.get("/albums/:id/tracks", spotify.getAlbumTracks);

router.get("/artists/:id", spotify.getArtistById);
router.get("/artists/:id/top-tracks", spotify.getArtistTopTracks);
router.get("/artists/:id/albums", spotify.getArtistAlbums);

router.get("/playlists/:id", spotify.getPlaylistById);
router.get("/playlists/:id/tracks", spotify.getPlaylistTracks);

module.exports = router;