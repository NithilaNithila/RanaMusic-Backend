const express = require("express");
const router = express.Router();
const saavn = require("../controllers/saavn.controller");

router.get("/search", saavn.searchGlobal);
router.get("/search/songs", saavn.searchTracks);
router.get("/search/albums", saavn.searchAlbums);
router.get("/search/artists", saavn.searchArtists);
router.get("/search/playlists", saavn.searchPlaylists);

router.get("/songs", saavn.getTracks);
router.get("/songs/:id/suggestions", saavn.getTrackSuggestions);
router.get("/songs/:id", saavn.getTrackById);
router.get("/songs/:id/lyrics", saavn.getLyrics);

router.get("/albums", saavn.getAlbums);
router.get("/albums/:id", saavn.getAlbumById);
router.get("/albums/:id/tracks", saavn.getAlbumTracks);

router.get("/artists", saavn.getArtists);
router.get("/artists/:id", saavn.getArtistById);
router.get("/artists/:id/songs", saavn.getArtistSongs);
router.get("/artists/:id/albums", saavn.getArtistAlbums);

router.get("/playlists", saavn.getPlaylists);
router.get("/playlists/:id/tracks", saavn.getPlaylistTracks);
router.get("/playlists/:id", saavn.getPlaylists);

module.exports = router;