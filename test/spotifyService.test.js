const { test, afterEach, beforeEach } = require("node:test");
const assert = require("node:assert");
const axiosMock = require("./helpers/mockAxios");
const { cache } = require("../src/services/cache.service");

let spotify;

beforeEach(() => {
  cache.flushAll();
  axiosMock.reset();
  axiosMock.install();
  spotify = axiosMock.fresh("../src/services/spotify.service");
});

afterEach(() => {
  axiosMock.restore();
});

test("search queries each type and maps results", async () => {
  axiosMock.setHandler((path, config) => {
    assert.strictEqual(path, "/search");
    return Promise.resolve({
      data: {
        results: [{ id: `t_${config.params.type}`, title: "S", artists: [{ name: "A" }] }],
      },
    });
  });
  const out = await spotify.search("q", { type: "track,album", limit: 5 });
  assert.ok(out.results.track);
  assert.ok(out.results.album);
  assert.strictEqual(out.results.track[0].id, "t_track");
  assert.strictEqual(out.results.album[0].id, "t_album");
});

test("search with type all resolves every search type", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { results: [] } }));
  const out = await spotify.search("q", { type: "all" });
  for (const t of ["track", "album", "artist", "playlist"]) {
    assert.ok(Array.isArray(out.results[t]));
  }
});

test("search defaults unknown type to track", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { results: [{ id: "t1" }] } }));
  const out = await spotify.search("q", { type: "bogus" });
  assert.ok(out.results.track);
});

test("getTrackById normalizes and returns null on 404", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { track: { id: "t1", title: "S" } } }));
  assert.strictEqual((await spotify.getTrackById("t1")).id, "t1");
  axiosMock.fail(404, "nf");
  assert.strictEqual(await spotify.getTrackById("bad"), null);
});

test("getAlbumById normalizes and returns null on 400", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { album: { id: "al", title: "A" } } }));
  assert.strictEqual((await spotify.getAlbumById("al")).id, "al");
  axiosMock.fail(400, "nf");
  assert.strictEqual(await spotify.getAlbumById("bad"), null);
});

test("getArtistById normalizes and returns null on 404", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { artist: { id: "ar", name: "A" } } }));
  assert.strictEqual((await spotify.getArtistById("ar")).id, "ar");
  axiosMock.fail(404);
  assert.strictEqual(await spotify.getArtistById("bad"), null);
});

test("getArtistTopTracks maps results", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { total: 1, tracks: [{ id: "t1", title: "S" }] } }));
  const out = await spotify.getArtistTopTracks("ar");
  assert.strictEqual(out.results[0].id, "t1");
});

test("getArtistAlbums maps results", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { total: 1, albums: [{ id: "al", title: "A" }] } }));
  const out = await spotify.getArtistAlbums("ar", { limit: 5 });
  assert.strictEqual(out.results[0].id, "al");
});

test("getPlaylistById normalizes and returns null on 404", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { playlist: { id: "pl", name: "P" } } }));
  assert.strictEqual((await spotify.getPlaylistById("pl")).id, "pl");
  axiosMock.fail(404);
  assert.strictEqual(await spotify.getPlaylistById("bad"), null);
});

test("wxfGet swallows upstream failures within search (allSettled)", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { success: false, error: "boom" } }));
  const out = await spotify.search("q", { type: "track" });
  assert.deepStrictEqual(out.results.track, []);
  assert.strictEqual(out.total, 0);
});

test("wxfGet unwraps a failed non-response into an upstream error on direct getters", async () => {
  axiosMock.setHandler(() => {
    const err = new Error("gone");
    err.isAxiosError = true;
    return Promise.reject(err);
  });
  await assert.rejects(spotify.getTrackById("nf-id-xyz"));
});

test("direct getters re-throw 5xx errors", async () => {
  axiosMock.fail(500, "boom");
  await assert.rejects(spotify.getAlbumById("e-alb"));
  await assert.rejects(spotify.getArtistById("e-art"));
  await assert.rejects(spotify.getArtistTopTracks("e-art"));
  await assert.rejects(spotify.getArtistAlbums("e-art"));
  await assert.rejects(spotify.getPlaylistById("e-pl"));
});
