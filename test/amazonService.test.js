const { test, afterEach, beforeEach } = require("node:test");
const assert = require("node:assert");
const axiosMock = require("./helpers/mockAxios");
const { cache } = require("../src/services/cache.service");

let amazon;

beforeEach(() => {
  cache.flushAll();
  axiosMock.reset();
  axiosMock.install();
  amazon = axiosMock.fresh("../src/services/amazon.service");
});

afterEach(() => {
  axiosMock.restore();
});

test("search queries types and maps results", async () => {
  axiosMock.setHandler((path) => {
    if (path === "/search/songs") return Promise.resolve({ data: { data: [{ id: "t1", title: "S", artist: { name: "A" } }] } });
    if (path === "/search/albums") return Promise.resolve({ data: { data: [{ id: "al", title: "A" }] } });
    return Promise.resolve({ data: { data: [] } });
  });
  const out = await amazon.search("q", { type: "all", limit: 5 });
  assert.strictEqual(out.results.track[0].id, "t1");
  assert.strictEqual(out.results.album[0].id, "al");
  for (const k of ["artist", "playlist"]) assert.ok(Array.isArray(out.results[k]));
});

test("search with a bogus type falls back to track", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: [{ id: "t1", title: "S" }] } }));
  const out = await amazon.search("q", { type: "bogus" });
  assert.strictEqual(out.results.track[0].id, "t1");
});

test("getTrackById normalizes or nulls on 404", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: { id: "t1", title: "S" } } }));
  assert.strictEqual((await amazon.getTrackById("t1")).id, "t1");
  axiosMock.fail(404, "nf");
  assert.strictEqual(await amazon.getTrackById("bad"), null);
});

test("getAlbumById normalizes or nulls on 400", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: { id: "al", title: "A" } } }));
  assert.strictEqual((await amazon.getAlbumById("al")).id, "al");
  axiosMock.fail(400, "nf");
  assert.strictEqual(await amazon.getAlbumById("bad"), null);
});

test("getArtistById normalizes or nulls", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: { id: "ar", name: "A" } } }));
  assert.strictEqual((await amazon.getArtistById("ar")).id, "ar");
  axiosMock.fail(404, "nf");
  assert.strictEqual(await amazon.getArtistById("bad"), null);
});

test("getArtistTopTracks maps results", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: { topSongs: [{ id: "t1", title: "S" }] } } }));
  const out = await amazon.getArtistTopTracks("ar", { limit: 5 });
  assert.strictEqual(out.results[0].id, "t1");
});

test("getPlaylistById normalizes or nulls", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: { id: "pl", name: "P" } } }));
  assert.strictEqual((await amazon.getPlaylistById("pl")).id, "pl");
  axiosMock.fail(404, "nf");
  assert.strictEqual(await amazon.getPlaylistById("bad"), null);
});

test("amzGet throws upstream error when data.success is false", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { success: false, message: "boom" } }));
  await assert.rejects(amazon.getTrackById("x"));
});

test("amzGet throws amazon error when the network is unreachable (no response)", async () => {
  axiosMock.setHandler(() => {
    const err = new Error("ENOTFOUND");
    err.isAxiosError = true; // no err.response
    return Promise.reject(err);
  });
  await assert.rejects(amazon.getTrackById("netfail"), /unreachable/);
});

test("getAlbumById re-throws non-404 errors", async () => {
  axiosMock.fail(500, "boom");
  await assert.rejects(amazon.getAlbumById("album-x1-err"));
});

test("getArtistById re-throws non-404 errors", async () => {
  axiosMock.fail(500, "boom");
  await assert.rejects(amazon.getArtistById("artist-x1-err"));
});

test("getArtistTopTracks re-throws non-404 errors", async () => {
  axiosMock.fail(500, "boom");
  await assert.rejects(amazon.getArtistTopTracks("artist-x2-err"));
});

test("getPlaylistById re-throws non-404 errors", async () => {
  axiosMock.fail(500, "boom");
  await assert.rejects(amazon.getPlaylistById("pl-x1-err"));
});
