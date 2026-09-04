const express = require("express");
const router = express.Router();

router.use("/search", require("./search.routes"));
router.use("/discover", require("./discover.routes"));
router.use("/tracks", require("./track.routes"));
router.use("/albums", require("./album.routes"));
router.use("/artists", require("./artist.routes"));
router.use("/playlists", require("./playlist.routes"));
router.use("/favorites", require("./favorite.routes"));
router.use("/liked-songs", require("./likedSong.routes"));
router.use("/auth", require("./auth.routes"));
router.use("/users", require("./user.routes"));
router.use("/lyrics", require("./lyrics.routes"));
router.use("/saavn", require("./saavn.routes"));
router.use("/spotify", require("./spotify.routes"));
router.use("/amazon", require("./amazon.routes"));
router.use("/ytmusic", require("./ytmusic.routes"));
router.use("/app-version", require("./version.routes"));

module.exports = router;
