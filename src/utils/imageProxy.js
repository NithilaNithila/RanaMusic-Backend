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

// Public origin where this backend is reachable (e.g. https://api.example.com
// for a Render/Railway deploy or https://localhost:5000 in dev). When set,
// proxied artwork is emitted as an ABSOLUTE /api/images/... URL so album and
// playlist covers render from any frontend origin — including a static host
// (Netlify/Vercel/GitHub Pages) that has no same-origin /api reverse proxy.
// The image proxy endpoint itself already sends Access-Control-Allow-Origin: *
// so absolute cross-origin requests are safe. When unset, the relative path is
// kept so classic same-origin mounting keeps working unchanged.
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || "").trim().replace(/\/+$/, "");

// Rewrites allow-listed https image URLs to the backend proxy (absolute when a
// public origin is configured, relative otherwise); everything else is returned
// untouched so a blocked host still renders (direct load) rather than breaking
// the artwork.
const toProxyUrl = (url) => {
  if (!url) return "";
  if (!isAllowedImageUrl(url)) return url;
  const path = `/api/images/image-proxy?url=${encodeURIComponent(url)}`;
  return PUBLIC_API_URL ? `${PUBLIC_API_URL}${path}` : path;
};

module.exports = { ALLOWED_IMAGE_HOSTS, isAllowedImageUrl, toProxyUrl, PUBLIC_API_URL };