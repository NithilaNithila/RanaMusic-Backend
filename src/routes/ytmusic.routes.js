const express = require("express");
const router = express.Router();
const yt = require("../controllers/ytmusic.controller");

router.get("/search", yt.search);
router.get("/search/suggestions", yt.searchSuggestions);

router.get("/songs/:id", yt.getTrackById);
router.get("/songs/:id/lyrics", yt.getLyrics);

router.get("/albums/:id", yt.getAlbumById);
router.get("/albums/:id/tracks", yt.getAlbumTracks);

router.get("/artists/:id", yt.getArtistById);
router.get("/artists/:id/top-tracks", yt.getArtistTopTracks);
router.get("/artists/:id/albums", yt.getArtistAlbums);

router.get("/playlists/:id", yt.getPlaylistById);
router.get("/playlists/:id/tracks", yt.getPlaylistTracks);

module.exports = router;