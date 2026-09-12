const axios = require("axios");
const asyncHandler = require("../utils/asyncHandler");
const { httpAgent, httpsAgent } = require("../config/http");

const client = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 15000,
  responseType: "arraybuffer",
  validateStatus: () => true,
});

const ALLOWED_DOMAINS = [
  "m.media-amazon.com",
  "images-na.ssl-images-amazon.com",
  "music.amazon.com",
  "aeon.co",
  "amazon.com",
  "amzn.co",
  "cdn.amazon.com",
  "images-na100.amazon.com",
  "photos-na.s3.amazonaws.com",
  "mosaic.tqlfi.com",
  "via.placeholder.com",
];

const isAllowedUrl = (url) => {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ALLOWED_DOMAINS.some((d) => hostname === d.toLowerCase() || hostname.endsWith("." + d.toLowerCase()));
  } catch (_) {
    return false;
  }
};

const proxyImage = asyncHandler(async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing 'url' query parameter" });
  }

  if (!isAllowedUrl(url)) {
    return res.status(400).json({ error: "Image domain not allowed" });
  }

  try {
    const response = await client.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Referer: "https://music.amazon.com/",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

    if (response.status !== 200) {
      return res.status(response.status).json({ error: "Failed to fetch image" });
    }

    const contentType = response.headers["content-type"] || "image/jpeg";
    const cacheControl = response.headers["cache-control"] || "public, max-age=86400";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", cacheControl);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.send(response.data);
  } catch (err) {
    if (err.code === "ECONNABORTED") {
      return res.status(504).json({ error: "Image fetch timeout" });
    }
    return res.status(502).json({ error: "Failed to fetch image" });
  }
});

module.exports = { proxyImage };