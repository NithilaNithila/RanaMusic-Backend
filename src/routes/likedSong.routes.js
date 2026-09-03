const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth.middleware");
const { userDataLimiter } = require("../middleware/rateLimiter.middleware");
const {
  getMyLikedSongs,
  addLikedSong,
  removeLikedSong,
} = require("../controllers/likedSong.controller");

router.use(protect);
router.use(userDataLimiter);

router.route("/").get(getMyLikedSongs).post(addLikedSong);
router.delete("/:trackId", removeLikedSong);

module.exports = router;
