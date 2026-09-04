const { test, afterEach, beforeEach } = require("node:test");
const assert = require("node:assert");
const axiosMock = require("./helpers/mockAxios");
const { cache } = require("../src/services/cache.service");

let buildFeed;

beforeEach(() => {
  cache.flushAll();
  axiosMock.reset();
  axiosMock.install();
  // Reset the module-level artistPool cache by evicting it from require.cache,
  // then load discover fresh so it requires a virgin artistPool instance.
  const artistPoolPath = require.resolve("../src/utils/artistPool");
  delete require.cache[artistPoolPath];
  buildFeed = axiosMock.fresh("../src/services/discover.service").buildFeed;
});

afterEach(() => {
  axiosMock.restore();
});

// Routes each provider's network call to the shape each service expects.
const happyHandler = () => (path, config) => {
  const params = config && config.params ? config.params : {};
  // ytmusic playlist search -> /search with filter=playlists, data is an array
  if (params.filter) {
    return Promise.resolve({ data: [{ id: `yt_${params.filter}`, title: "YT Top" }] });
  }
  // spotify playlist search -> /search with type=playlist, data.results array
  if (params.type) {
    return Promise.resolve({ data: { results: [{ id: `sp_${params.type}`, name: "Spotify List" }] } });
  }
  // saavn tracks / albums / artists
  if (path === "/search/songs") {
    return Promise.resolve({
      data: { data: { results: [{ id: "s1", name: "Track 1", artist_name: "A", language: "" }], total: 1 } },
    });
  }
  if (path === "/search/albums") {
    return Promise.resolve({
      data: { data: { results: [{ id: "a1", name: "Album 1", primary_artists: "X", image: [{ quality: "500x500", url: "http://img" }] }], total: 1 } },
    });
  }
  if (path === "/search/artists") {
    return Promise.resolve({
      data: { data: { results: [{ id: "ar1", name: "Artist 1", image: "http://i" }], total: 1 } },
    });
  }
  // amazon playlist search -> /search/playlists, data.data is an array
  if (path === "/search/playlists") {
    return Promise.resolve({ data: { data: [{ id: "am1", name: "Amazon List" }] } });
  }
  return Promise.resolve({ data: { data: { results: [] } } });
};

test("buildFeed composes all four sections with happy sources", async () => {
  axiosMock.setHandler(happyHandler());
  const feed = await buildFeed({});
  assert.strictEqual(feed.sections.tracks.length, 1);
  assert.strictEqual(feed.sections.albums.length, 1);
  assert.strictEqual(feed.sections.artists.length, 1);
  assert.ok(feed.sections.playlists.length >= 1);
  assert.ok(feed.day >= 0);
  assert.ok(typeof feed.generatedAt === "string");
});

test("buildFeed clamps limits to the configured bounds", async () => {
  axiosMock.setHandler(happyHandler());
  const feed = await buildFeed({ limit: 9999 });
  assert.ok(feed.sections.tracks.length <= 50);
  assert.ok(feed.sections.albums.length <= 50);
  assert.ok(feed.sections.artists.length <= 50);
  assert.ok(feed.sections.playlists.length <= 50);
});

test("buildFeed degrades gracefully when all upstreams fail", async () => {
  // Fully isolate from any prior test's module-level artistPool cache by
  // evicting and re-loading both modules inside this test, then failing.
  delete require.cache[require.resolve("../src/utils/artistPool")];
  delete require.cache[require.resolve("../src/services/discover.service")];
  const freshFeed = axiosMock.fresh("../src/services/discover.service").buildFeed;
  axiosMock.fail(500, "boom");
  const feed = await freshFeed({});
  assert.deepStrictEqual(feed.sections.tracks, []);
  assert.deepStrictEqual(feed.sections.albums, []);
  assert.deepStrictEqual(feed.sections.artists, []);
  assert.deepStrictEqual(feed.sections.playlists, []);
});
