const { test, afterEach, beforeEach } = require("node:test");
const assert = require("node:assert");
const axiosMock = require("./helpers/mockAxios");
const { cache } = require("../src/services/cache.service");

let yt;

beforeEach(() => {
  cache.flushAll();
  axiosMock.reset();
  axiosMock.install();
  yt = axiosMock.fresh("../src/services/ytmusic.service");
});

afterEach(() => {
  axiosMock.restore();
});

test("search queries each type and maps results", async () => {
  axiosMock.setHandler((path, config) => {
    assert.strictEqual(path, "/search");
    assert.strictEqual(config.params.query, "q");
    const filter = config.params.filter;
    const item =
      filter === "albums"
        ? { browseId: "al1", title: "Album", tracks: [{ videoId: "t1", title: "X" }] }
        : { videoId: `v_${filter}`, title: "S" };
    return Promise.resolve({ data: [item] });
  });
  const out = await yt.search("q", { type: "track,album", limit: 5 });
  assert.strictEqual(out.results.track[0].id, "v_songs");
  assert.strictEqual(out.results.album[0].id, "al1");
});

test("search with type all returns all four buckets", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: [] }));
  const out = await yt.search("q", { type: "all" });
  for (const t of ["track", "album", "artist", "playlist"]) {
    assert.ok(Array.isArray(out.results[t]));
  }
});

test("search maps the artist bucket", async () => {
  axiosMock.setHandler((path, config) => {
    assert.strictEqual(config.params.filter, "artists");
    return Promise.resolve({ data: [{ channelId: "ch1", title: "Some Artist" }] });
  });
  const out = await yt.search("q", { type: "artist", limit: 5 });
  assert.strictEqual(out.results.artist[0].id, "ch1");
});

test("direct getters re-throw 5xx errors", async () => {
  axiosMock.fail(500, "boom");
  await assert.rejects(yt.getTrackById("e-tr"));
  await assert.rejects(yt.getAlbumById("e-al"));
  await assert.rejects(yt.getArtistById("e-ar"));
  await assert.rejects(yt.getArtistTopTracks("e-ar"));
  await assert.rejects(yt.getArtistAlbums("e-ar"));
  await assert.rejects(yt.getPlaylistById("e-pl"));
});

test("searchSuggestions returns array", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: ["a", "b"] }));
  assert.deepStrictEqual(await yt.searchSuggestions("abc"), ["a", "b"]);
  cache.flushAll();
  axiosMock.setHandler(() => Promise.resolve({ data: null }));
  assert.deepStrictEqual(await yt.searchSuggestions("def"), []);
});

test("getTrackById normalizes or nulls", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { tracks: [{ videoId: "v1", title: "S" }] } }));
  assert.strictEqual((await yt.getTrackById("v1")).id, "v1");
  axiosMock.setHandler(() => Promise.resolve({ data: { tracks: [] } }));
  assert.strictEqual(await yt.getTrackById("none"), null);
  axiosMock.fail(404, "nf");
  assert.strictEqual(await yt.getTrackById("nf"), null);
});

test("getLyrics returns lyrics or null", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { lyrics: "la" } }));
  assert.strictEqual(await yt.getLyrics("v1"), "la");
  axiosMock.setHandler(() => Promise.resolve({ data: { text: "ta" } }));
  assert.strictEqual(await yt.getLyrics("v2"), "ta");
  axiosMock.fail(500, "err");
  assert.strictEqual(await yt.getLyrics("v3"), null);
});

test("getAlbumById normalizes or nulls", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { title: "Album", artists: [{ name: "A" }], tracks: [{ videoId: "t1" }] } }));
  assert.strictEqual((await yt.getAlbumById("al")).id, "al");
  axiosMock.fail(400, "nf");
  assert.strictEqual(await yt.getAlbumById("al2"), null);
});

test("getArtistById normalizes or nulls", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { channelId: "ch", name: "A" } }));
  assert.strictEqual((await yt.getArtistById("ch")).id, "ch");
  axiosMock.fail(404, "nf");
  assert.strictEqual(await yt.getArtistById("ch2"), null);
});

test("getArtistTopTracks maps results", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { songs: { results: [{ videoId: "v1", title: "S" }] } } }));
  const out = await yt.getArtistTopTracks("ch");
  assert.strictEqual(out.results[0].id, "v1");
  axiosMock.fail(404, "nf");
  assert.deepStrictEqual(await yt.getArtistTopTracks("ch2"), { total: 0, results: [] });
});

test("getArtistAlbums maps results and nulls on 404", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { albums: { results: [{ browseId: "al", title: "A", tracks: [{ videoId: "t1" }] }] } } }));
  const out = await yt.getArtistAlbums("ch");
  assert.strictEqual(out.results[0].id, "al");
  axiosMock.fail(404, "nf");
  assert.deepStrictEqual(await yt.getArtistAlbums("ch2"), { total: 0, results: [] });
});

test("getPlaylistById normalizes or nulls", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { playlistId: "pl", title: "P" } }));
  assert.strictEqual((await yt.getPlaylistById("pl")).id, "pl");
  axiosMock.fail(400, "nf");
  assert.strictEqual(await yt.getPlaylistById("pl2"), null);
});
