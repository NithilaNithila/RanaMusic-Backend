// Single source of truth for which image hosts the backend is willing to
// proxy. Util (toProxyUrl) and controller (imageProxy.controller) share this
// so the two trust policies can never drift apart again. Anything not in the
// list is passed through untouched by toProxyUrl and rejected outright by the
// proxy endpoint.

const ALLOWED_IMAGE_HOSTS = [
  "m.media-amazon.com",
  "images-na.ssl-images-amazon.com",
  "photos-na.ssl-images-amazon.com",
  "music.amazon.com",
  "cdn.amazon.com",
];

// https-only + exact/subdomain match against the allowlist. Rejects http,
// non-http schemes, IP literals, and any host not owned by the list.
const isAllowedImageUrl = (url) => {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_IMAGE_HOSTS.some(
      (d) => hostname === d.toLowerCase() || hostname.endsWith("." + d.toLowerCase())
    );
  } catch (_) {
    return false;
  }
};

// Rewrites allow-listed https image URLs to the backend proxy; everything else
// is returned untouched so a blocked host still renders (direct load) rather
// than breaking the artwork.
const toProxyUrl = (url) => {
  if (!url) return "";
  if (!isAllowedImageUrl(url)) return url;
  return `/api/images/image-proxy?url=${encodeURIComponent(url)}`;
};

module.exports = { ALLOWED_IMAGE_HOSTS, isAllowedImageUrl, toProxyUrl };