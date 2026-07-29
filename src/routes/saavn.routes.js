const express = require("express");
const router = express.Router();
const saavn = require("../controllers/saavn.controller");

router.get("/search", saavn.searchGlobal);
router.get("/search/songs", saavn.searchTracks);
router.get("/search/albums", saavn.searchAlbums);
router.get("/search/artists", saavn.searchArtists);

router.get("/songs/:id", saavn.getTrackById);
router.get("/songs/:id/lyrics", saavn.getLyrics);

router.get("/albums/:id", saavn.getAlbumById);
router.get("/albums/:id/tracks", saavn.getAlbumTracks);

router.get("/artists/:id", saavn.getArtistById);
router.get("/artists/:id/songs", saavn.getArtistSongs);
router.get("/artists/:id/albums", saavn.getArtistAlbums);

module.exports = router;
