const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

// PUBLIC_API_URL is read at require-time, so rebuild the module for each side.
const load = () => {
  const p = path.join(__dirname, "..", "src", "utils", "imageProxy.js");
  delete require.cache[require.resolve(p)];
  return require(p);
};

test("allow-listed https host becomes a relative proxy path when no public URL is set", () => {
  const { toProxyUrl } = load();
  const out = toProxyUrl("https://m.media-amazon.com/images/I/abc.jpg");
  assert.strictEqual(out, "/api/images/image-proxy?url=https%3A%2F%2Fm.media-amazon.com%2Fimages%2FI%2Fabc.jpg");
});

test("allow-listed https host becomes an absolute proxy URL when PUBLIC_API_URL is set", () => {
  process.env.PUBLIC_API_URL = "https://api.example.com";
  try {
    const { toProxyUrl } = load();
    const out = toProxyUrl("https://m.media-amazon.com/images/I/abc.jpg");
    assert.strictEqual(out, "https://api.example.com/api/images/image-proxy?url=https%3A%2F%2Fm.media-amazon.com%2Fimages%2FI%2Fabc.jpg");
  } finally {
    delete process.env.PUBLIC_API_URL;
  }
});

test("PUBLIC_API_URL with a trailing slash is normalized", () => {
  process.env.PUBLIC_API_URL = "https://api.example.com/";
  try {
    const { toProxyUrl } = load();
    const out = toProxyUrl("https://m.media-amazon.com/images/I/abc.jpg");
    assert.strictEqual(out, "https://api.example.com/api/images/image-proxy?url=https%3A%2F%2Fm.media-amazon.com%2Fimages%2FI%2Fabc.jpg");
  } finally {
    delete process.env.PUBLIC_API_URL;
  }
});

test("non allow-listed hosts pass through untouched", () => {
  const { toProxyUrl, isAllowedImageUrl, PUBLIC_API_URL } = load();
  assert.strictEqual(isAllowedImageUrl("https://i.scdn.co/image/xyz"), false);
  assert.strictEqual(isAllowedImageUrl("https://c.saavncdn.com/815/x-500x500.jpg"), false);
  assert.strictEqual(toProxyUrl("https://i.scdn.co/image/xyz"), "https://i.scdn.co/image/xyz");
  assert.strictEqual(PUBLIC_API_URL, "");
});

test("http, non-image and empty URLs are rejected or passed through safely", () => {
  const { isAllowedImageUrl, toProxyUrl } = load();
  assert.strictEqual(isAllowedImageUrl("http://m.media-amazon.com/images/I/x.jpg"), false);
  assert.strictEqual(isAllowedImageUrl(""), false);
  assert.strictEqual(toProxyUrl(""), "");
  assert.strictEqual(toProxyUrl(undefined), "");
  assert.strictEqual(toProxyUrl(null), "");
});