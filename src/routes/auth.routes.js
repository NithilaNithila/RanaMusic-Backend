const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth.middleware");
const { authLimiter } = require("../middleware/rateLimiter.middleware");
const validate = require("../middleware/validate.middleware");
const { register, login, getMe } = require("../controllers/auth.controller");

router.post(
  "/register",
  authLimiter,
  validate(["username", "email", "password"]),
  register
);
router.post("/login", authLimiter, validate(["email", "password"]), login);
router.get("/me", protect, getMe);

module.exports = router;
