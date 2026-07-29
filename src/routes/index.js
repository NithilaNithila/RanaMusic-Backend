const express = require("express");
const router = express.Router();

router.use("/tracks", require("./track.routes"));
router.use("/albums", require("./album.routes"));
router.use("/artists", require("./artist.routes"));
router.use("/playlists", require("./playlist.routes"));
router.use("/favorites", require("./favorite.routes"));
router.use("/auth", require("./auth.routes"));
router.use("/users", require("./user.routes"));

module.exports = router;
