const { test } = require("node:test");
const assert = require("node:assert");
const {
  LANGUAGES,
  LANGUAGE_NAMES,
  sanitizeLang,
  isLangValue,
  isInLanguage,
  TRACK_QUERIES,
  ALBUM_QUERIES,
  ARTIST_SEEDS,
} = require("../src/config/languages");

test("LANGUAGES covers the six supported codes", () => {
  for (const code of ["en", "hi", "ta", "te", "ml", "kn"]) {
    assert.ok(LANGUAGES[code]);
    assert.strictEqual(LANGUAGES[code].code, code);
  }
});

test("sanitizeLang returns a supported code or defaults to hi", () => {
  assert.strictEqual(sanitizeLang("en"), "en");
  assert.strictEqual(sanitizeLang("ta"), "ta");
  assert.strictEqual(sanitizeLang("fr"), "hi");
  assert.strictEqual(sanitizeLang(undefined), "hi");
  assert.strictEqual(sanitizeLang(""), "hi");
});

test("isLangValue returns the code only for supported languages", () => {
  assert.strictEqual(isLangValue("te"), "te");
  assert.strictEqual(isLangValue("xx"), null);
  assert.strictEqual(isLangValue(undefined), null);
  assert.strictEqual(isLangValue(""), null);
});

test("isInLanguage matches item language name against the language", () => {
  assert.strictEqual(isInLanguage({ language: "Hindi" }, "hi"), true);
  assert.strictEqual(isInLanguage({ language: "latin hindi" }, "hi"), true);
  assert.strictEqual(isInLanguage({ language: "English" }, "en"), true);
  assert.strictEqual(isInLanguage({ language: "French" }, "hi"), false);
  assert.strictEqual(isInLanguage({ language: "" }, "hi"), false);
  assert.strictEqual(isInLanguage(null, "hi"), false);
  assert.strictEqual(isInLanguage({ language: "Hindi" }, "xx"), false);
  assert.strictEqual(isInLanguage({ language: "Hindi" }, undefined), false);
});

test("query/seed maps expose non-empty per-language lists", () => {
  for (const code of Object.keys(LANGUAGES)) {
    assert.ok(TRACK_QUERIES[code].length > 0);
    assert.ok(ALBUM_QUERIES[code].length > 0);
    assert.ok(ARTIST_SEEDS[code].length > 0);
  }
});
