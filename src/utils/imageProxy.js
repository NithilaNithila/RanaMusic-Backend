const toProxyUrl = (url) => {
  if (!url) return "";
  try {
    const hostname = new URL(url).hostname;
    const allowed = [
      "m.media-amazon.com",
      "images-na.ssl-images-amazon.com",
      "music.amazon.com",
    ];
    const isAllowed = allowed.some((d) => hostname === d || hostname.endsWith("." + d));
    if (!isAllowed) return url;
    return `/api/images/image-proxy?url=${encodeURIComponent(url)}`;
  } catch (_) {
    return url;
  }
};

module.exports = { toProxyUrl };