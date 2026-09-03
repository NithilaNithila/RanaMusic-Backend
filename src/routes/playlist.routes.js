const express = require("express");
const router = express.Router();
const { protect, optionalAuth } = require("../middleware/auth.middleware");
const { userDataLimiter } = require("../middleware/rateLimiter.middleware");
const validate = require("../middleware/validate.middleware");
const {
  getMyPlaylists,
  getPublicPlaylists,
  getAllPlaylists,
  getPlaylistById,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
} = require("../controllers/playlist.controller");
const { getCatalogPlaylists } = require("../controllers/catalog.controller");

// Public routes (no auth) — must be declared before `protect`.
router.get("/catalog", getCatalogPlaylists);
router.get("/public", getPublicPlaylists);
// Optional auth so a signed-in user's own private playlists are included in
// /all, while anonymous visitors still see only public ones.
router.get("/all", optionalAuth, getAllPlaylists);
// Optional auth so a private playlist's owner can view it by id, while
// anonymous visitors can still open public playlists.
router.get("/:id", optionalAuth, getPlaylistById);

router.use(protect);
router.use(userDataLimiter);

router.route("/").get(getMyPlaylists).post(createPlaylist);

router
  .route("/:id")
  .put(updatePlaylist)
  .delete(deletePlaylist);

router.post("/:id/tracks", validate(["jamendoId"]), addTrackToPlaylist);
router.delete("/:id/tracks/:jamendoId", removeTrackFromPlaylist);

module.exports = router;