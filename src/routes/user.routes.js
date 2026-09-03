const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth.middleware");
const { userDataLimiter } = require("../middleware/rateLimiter.middleware");
const validate = require("../middleware/validate.middleware");
const {
  updateProfile,
  getHistory,
  addHistoryEntry,
  changePassword,
} = require("../controllers/user.controller");

router.use(protect);
router.use(userDataLimiter);

router.put("/me", updateProfile);
router.put("/me/password", validate(["currentPassword", "newPassword"]), changePassword);
router.get("/me/history", getHistory);
router.post("/me/history", validate(["jamendoId"]), addHistoryEntry);

module.exports = router;
