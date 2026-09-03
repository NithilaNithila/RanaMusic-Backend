const express = require("express");
const router = express.Router();
const { discover } = require("../controllers/discover.controller");

router.get("/", discover);

module.exports = router;
