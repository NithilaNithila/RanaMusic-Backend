const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth.middleware");
const { authLimiter } = require("../middleware/rateLimiter.middleware");
const validate = require("../middleware/validate.middleware");
const { register, login, getMe, deleteMe, forgotPassword, resetPassword } = require("../controllers/auth.controller");

// register must reject a non-string username before the controller destructures
// it, while password length is enforced by the 8–72 cap in the validator.
router.post(
  "/register",
  authLimiter,
  validate(["username", "email", "password"], { username: { min: 3, max: 30 } }),
  register
);
router.post("/login", authLimiter, validate(["email", "password"]), login);
router.post("/forgot-password", authLimiter, validate(["email"]), forgotPassword);
router.post("/reset-password", authLimiter, validate(["token", "newPassword"]), resetPassword);
router.get("/me", protect, getMe);
router.delete("/me", protect, deleteMe);

module.exports = router;
