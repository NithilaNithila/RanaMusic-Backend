const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth.middleware");
const {
  updateProfile,
  getHistory,
  addHistoryEntry,
} = require("../controllers/user.controller");

router.use(protect);

router.put("/me", updateProfile);
router.get("/me/history", getHistory);
router.post("/me/history", addHistoryEntry);

module.exports = router;
