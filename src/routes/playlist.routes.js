const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth.middleware");
const {
  getMyPlaylists,
  getPlaylistById,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
} = require("../controllers/playlist.controller");

router.use(protect);

router.route("/").get(getMyPlaylists).post(createPlaylist);

router
  .route("/:id")
  .get(getPlaylistById)
  .put(updatePlaylist)
  .delete(deletePlaylist);

router.post("/:id/tracks", addTrackToPlaylist);
router.delete("/:id/tracks/:jamendoId", removeTrackFromPlaylist);

module.exports = router;
