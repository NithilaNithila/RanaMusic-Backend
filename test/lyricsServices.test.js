const { test, afterEach, beforeEach } = require("node:test");
const assert = require("node:assert");
const axiosMock = require("./helpers/mockAxios");
const { cache } = require("../src/services/cache.service");

let lyricsovh;
let lrclib;

beforeEach(() => {
  cache.flushAll();
  axiosMock.reset();
  axiosMock.install();
  lyricsovh = axiosMock.fresh("../src/services/lyricsovh.service");
  lrclib = axiosMock.fresh("../src/services/lrclib.service");
});

afterEach(() => {
  axiosMock.restore();
});

test("lyricsovh returns lyrics or null", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { lyrics: "la la" } }));
  assert.strictEqual(await lyricsovh.getLyrics("A", "S"), "la la");
  axiosMock.setHandler(() => Promise.resolve({ data: { lyrics: null } }));
  assert.strictEqual(await lyricsovh.getLyrics("A", "S2"), null);
});

test("lyricsovh returns null for missing artist/title", async () => {
  assert.strictEqual(await lyricsovh.getLyrics("", "S"), null);
  assert.strictEqual(await lyricsovh.getLyrics("A", ""), null);
});

test("lyricsovh returns null on upstream failure", async () => {
  axiosMock.fail(500, "boom");
  assert.strictEqual(await lyricsovh.getLyrics("A", "S3"), null);
});

test("lrclib returns plain lyrics, preferring plain over synced", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { plainLyrics: "plain", syncedLyrics: "synced" } }));
  assert.strictEqual(await lrclib.getLyrics("A", "S"), "plain");
});

test("lrclib falls back to synced lyrics when plain is absent", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { syncedLyrics: "synced" } }));
  assert.strictEqual(await lrclib.getLyrics("A", "S4"), "synced");
});

test("lrclib returns null for missing input and upstream failure", async () => {
  assert.strictEqual(await lrclib.getLyrics("", "S"), null);
  axiosMock.fail(500, "boom");
  assert.strictEqual(await lrclib.getLyrics("A", "S5"), null);
});
