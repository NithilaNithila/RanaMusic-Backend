const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth.middleware");
const { userDataLimiter } = require("../middleware/rateLimiter.middleware");
const validate = require("../middleware/validate.middleware");
const {
  getMyFavorites,
  addFavorite,
  removeFavorite,
} = require("../controllers/favorite.controller");

router.use(protect);
router.use(userDataLimiter);

router.route("/").get(getMyFavorites).post(validate(["itemType", "jamendoId"]), addFavorite);
router.delete("/:itemType/:jamendoId", removeFavorite);

module.exports = router;
