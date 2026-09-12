const express = require("express");
const router = express.Router();
const { protect, optionalAuth } = require("../middleware/auth.middleware");
const { userDataLimiter, apiLimiter } = require("../middleware/rateLimiter.middleware");
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

// Public routes (no auth) — must be declared before `protect`. Read-heavy, so
// they sit behind the broad apiLimiter rather than the per-user limiter.
router.get("/catalog", apiLimiter, getCatalogPlaylists);
router.get("/public", apiLimiter, getPublicPlaylists);
// Optional auth so a signed-in user's own private playlists are included in
// /all, while anonymous visitors still see only public ones.
router.get("/all", apiLimiter, optionalAuth, getAllPlaylists);
// Optional auth so a private playlist's owner can view it by id, while
// anonymous visitors can still open public playlists.
router.get("/:id", apiLimiter, optionalAuth, getPlaylistById);

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