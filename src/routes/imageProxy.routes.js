const express = require("express");
const router = express.Router();
const { proxyImage } = require("../controllers/imageProxy.controller");

router.get("/image-proxy", proxyImage);

module.exports = router;