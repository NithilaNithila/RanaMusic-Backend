const axios = require("axios");
const asyncHandler = require("../utils/asyncHandler");
const { httpAgent, httpsAgent } = require("../config/http");
const { isAllowedImageUrl } = require("../utils/imageProxy");

const client = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 15000,
  responseType: "arraybuffer",
  validateStatus: () => true,
  maxRedirects: 0, // redirects are followed manually so every hop is re-vetted
});

// A redirect off an allow-listed host cannot silently jump to an arbitrary
// destination; each hop must itself pass the https + hostname check.
const MAX_REDIRECTS = 4;

const proxyImage = asyncHandler(async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing 'url' query parameter" });
  }

  if (!isAllowedImageUrl(url)) {
    return res.status(400).json({ error: "Image domain not allowed" });
  }

  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await client.get(current, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          Referer: "https://music.amazon.com/",
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
      });

      const status = response.status;
      const location = response.headers && response.headers.location;
      if (status >= 300 && status < 400 && location) {
        const next = new URL(location, current).toString();
        if (!isAllowedImageUrl(next)) {
          return res.status(400).json({ error: "Image redirect not allowed" });
        }
        current = next;
        continue;
      }

      if (status !== 200) {
        return res.status(status).json({ error: "Failed to fetch image" });
      }

      const contentType = response.headers["content-type"] || "image/jpeg";
      if (!/^image\//i.test(contentType)) {
        return res.status(502).json({ error: "Upstream did not return an image" });
      }
      const cacheControl = response.headers["cache-control"] || "public, max-age=86400";

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", cacheControl);
      res.setHeader("Access-Control-Allow-Origin", "*");
      // Explicitly null the credentials header so the wildcard origin and
      // credentials flags don't form the invalid ACAO:* + credentials:true combo.
      res.setHeader("Access-Control-Allow-Credentials", "false");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.send(response.data);
      return undefined;
    }
    return res.status(502).json({ error: "Too many redirects" });
  } catch (err) {
    if (err.code === "ECONNABORTED") {
      return res.status(504).json({ error: "Image fetch timeout" });
    }
    return res.status(502).json({ error: "Failed to fetch image" });
  }
});

module.exports = { proxyImage };