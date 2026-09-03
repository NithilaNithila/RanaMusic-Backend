const { test, afterEach, beforeEach } = require("node:test");
const assert = require("node:assert");
const axiosMock = require("./helpers/mockAxios");
const { cache } = require("../src/services/cache.service");

let searchService;

beforeEach(() => {
  cache.flushAll();
  axiosMock.reset();
  axiosMock.install();
  searchService = axiosMock.fresh("../src/services/search.service");
});

afterEach(() => {
  axiosMock.restore();
});

// Distinguish providers by the URL path they hit:
//  - saavn: /search/songs, /search/albums, /search/artists
//  - spotify/yt/amazon: /search (spotify), /search (yt), /search/songs (amazon)
const trackResult = (id) => ({ id, name: `Track ${id}`, artist_name: "Artist" });

test("resolveTypes returns defaults for all/absent and filters invalid", () => {
  assert.deepStrictEqual(searchService.resolveTypes(undefined), ["track", "album", "artist", "playlist"]);
  assert.deepStrictEqual(searchService.resolveTypes("all"), ["track", "album", "artist", "playlist"]);
  assert.deepStrictEqual(searchService.resolveTypes("track,album"), ["track", "album"]);
  assert.deepStrictEqual(searchService.resolveTypes("bogus"), ["track", "album", "artist", "playlist"]);
});

test("search merges and dedupes results across providers by key", async () => {
  axiosMock.setHandler((path) => {
    // saavn provider -> /search/songs-style path
    if (path.includes("/search/songs")) {
      return Promise.resolve({ data: { data: { results: [trackResult("a"), trackResult("b")], total: 2 } } });
    }
    // spotify + ytmusic -> /search
    if (path === "/search") {
      return Promise.resolve({ data: { results: [trackResult("b"), trackResult("c")] } });
    }
    // ytmusic unhandled here -> empty array style? yt returns data as an array.
    // amazon -> /search/songs handled above; add /search/albums etc. below.
    return Promise.resolve({ data: { data: { results: [] } } });
  });

  const out = await searchService.search("q", { type: "track", limit: 10 });
  assert.strictEqual(out.results.tracks.length, 3); // a, b (deduped), c
});

test("search collects all four result buckets when type is all", async () => {
  axiosMock.setHandler((path) => {
    if (path.includes("/search/songs")) return Promise.resolve({ data: { data: { results: [trackResult("t")], total: 1 } } });
    if (path.includes("/search/albums")) return Promise.resolve({ data: { data: { results: [{ id: "al", name: "Album", artist_name: "A" }], total: 1 } } });
    if (path.includes("/search/artists")) return Promise.resolve({ data: { data: { results: [{ id: "ar", name: "Artist" }], total: 1 } } });
    if (path === "/search") return Promise.resolve({ data: { results: [] } });
    if (path.includes("/search/playlists")) return Promise.resolve({ data: { data: { results: [{ id: "pl", name: "Playlist" }], total: 1 } } });
    return Promise.resolve({ data: { data: { results: [] } } });
  });

  const out = await searchService.search("q", { limit: 10 });
  assert.ok(Array.isArray(out.results.tracks));
  assert.ok(Array.isArray(out.results.albums));
  assert.ok(Array.isArray(out.results.artists));
  assert.ok(Array.isArray(out.results.playlists));
});

test("search tolerates upstream failures (safe wrapper returns empty)", async () => {
  axiosMock.fail(500, "boom");
  const out = await searchService.search("q", { type: "track", limit: 10 });
  assert.deepStrictEqual(out.results.tracks, []);
  assert.strictEqual(out.total, 0);
});

test("search memoizes identical queries", async () => {
  let calls = 0;
  axiosMock.setHandler((path) => {
    calls += 1;
    return Promise.resolve({ data: { data: { results: [trackResult("a")], total: 1 } } });
  });
  await searchService.search("same", { type: "track", limit: 5 });
  const afterFirst = calls; // 4 providers fire once
  await searchService.search("same", { type: "track", limit: 5 });
  assert.strictEqual(calls, afterFirst); // memoized -> no additional upstream calls
  assert.ok(afterFirst >= 4);
});
