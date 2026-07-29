const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth.middleware");
const {
  getMyFavorites,
  addFavorite,
  removeFavorite,
} = require("../controllers/favorite.controller");

router.use(protect);

router.route("/").get(getMyFavorites).post(addFavorite);
router.delete("/:itemType/:jamendoId", removeFavorite);

module.exports = router;
