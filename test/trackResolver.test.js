const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const axiosMock = require("./helpers/mockAxios");
const { cache } = require("../src/services/cache.service");

let resolver;

beforeEach(() => {
  cache.flushAll();
  axiosMock.reset();
  axiosMock.install();
  // Load saavn first so the mock axios client is shared, then resolver.
  axiosMock.fresh("../src/services/saavn.service");
  delete require.cache[require.resolve("../src/services/trackResolver.service")];
  resolver = require("../src/services/trackResolver.service");
});

afterEach(() => {
  axiosMock.restore();
});

const songData = {
  results: [
    {
      id: "t1",
      name: "Vaathi Coming",
      artists: { primary: [{ id: "a1", name: "Anirudh" }], featured: [] },
      image: [],
      downloadUrl: [{ quality: "320kbps", url: "https://cdn.example/full.mp3" }],
      duration: 212,
    },
  ],
  total: 1,
};

test("isPreviewAudioUrl flags empty, missing, and p.scdn.co urls", () => {
  assert.strictEqual(resolver.isPreviewAudioUrl(""), true);
  assert.strictEqual(resolver.isPreviewAudioUrl("   "), true);
  assert.strictEqual(resolver.isPreviewAudioUrl(undefined), true);
  assert.strictEqual(
    resolver.isPreviewAudioUrl("https://p.scdn.co/mp3-preview/xyz"),
    true
  );
  assert.strictEqual(
    resolver.isPreviewAudioUrl("https://cdn.example/full.mp3"),
    false
  );
});

test("parseArtists splits feat./ft./&/and separators into tokens", () => {
  assert.deepStrictEqual(
    resolver.parseArtists("Saurav Srisan feat. Tanisha Gnanavel"),
    ["saurav srisan", "tanisha gnanavel"]
  );
  assert.deepStrictEqual(
    resolver.parseArtists("Saurav Srisan, Tanisha Gnanavel"),
    ["saurav srisan", "tanisha gnanavel"]
  );
  assert.deepStrictEqual(
    resolver.parseArtists("Anirudh ft. Jonita Gandhi"),
    ["anirudh", "jonita gandhi"]
  );
  assert.deepStrictEqual(
    resolver.parseArtists("A & B"),
    ["a", "b"]
  );
  assert.deepStrictEqual(resolver.parseArtists(""), []);
});

test("findFullTrack matches when query uses feat. and query strips to primary artist", async () => {
  axiosMock.setHandler((path, config) => {
    assert.match(path, /search\/songs/);
    return Promise.resolve({ data: { data: songData } });
  });
  const out = await resolver.findFullTrack({
    name: "Vaathi Coming",
    artist: "Anirudh feat. Jonita Gandhi",
  });
  assert.strictEqual(out.id, "t1");
  assert.strictEqual(out.audio, "https://cdn.example/full.mp3");
});

test("findFullTrack returns a matching playable track", async () => {
  axiosMock.setHandler((path, config) => {
    assert.match(path, /search\/songs/);
    assert.strictEqual(config.params.query, "Vaathi Coming Anirudh");
    return Promise.resolve({ data: { data: songData } });
  });
  const out = await resolver.findFullTrack({
    name: "Vaathi Coming",
    artist: "Anirudh",
  });
  assert.strictEqual(out.id, "t1");
  assert.strictEqual(out.audio, "https://cdn.example/full.mp3");
  assert.strictEqual(out.duration, 212);
});

test("findFullTrack prefers the exact versioned title over the base title", async () => {
  axiosMock.respond({
    data: {
      results: [
        {
          id: "plain",
          name: "Rathinamo",
          artists: { primary: [{ id: "a1", name: "Saurav Srisan" }], featured: [] },
          image: [],
          downloadUrl: [{ quality: "320kbps", url: "https://cdn.example/plain.mp3" }],
          duration: 160,
        },
        {
          id: "female",
          name: "Rathinamo (Female Version)",
          artists: { primary: [{ id: "a1", name: "Saurav Srisan" }, { id: "a2", name: "Tanisha Gnanavel" }], featured: [] },
          image: [],
          downloadUrl: [{ quality: "320kbps", url: "https://cdn.example/female.mp3" }],
          duration: 190,
        },
      ],
      total: 2,
    },
  });
  const out = await resolver.findFullTrack({
    name: "Rathinamo (Female Version)",
    artist: "Saurav Srisan feat. Tanisha Gnanavel",
  });
  assert.strictEqual(out.id, "female");
  assert.strictEqual(out.audio, "https://cdn.example/female.mp3");
});

test("findFullTrack returns null when nothing matches well", async () => {
  axiosMock.respond({ data: { results: [] } });
  const out = await resolver.findFullTrack({
    name: "Some Obscure Track",
    artist: "Nobody",
  });
  assert.strictEqual(out, null);
});

test("resolvePlayableAudio replaces a preview url with a full track", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: songData } }));
  const out = await resolver.resolvePlayableAudio({
    name: "Vaathi Coming",
    artist: "Anirudh",
    audioUrl: "https://p.scdn.co/mp3-preview/xyz",
    duration: 212,
  });
  assert.strictEqual(out.audioUrl, "https://cdn.example/full.mp3");
  assert.strictEqual(out.duration, 212);
});

test("resolvePlayableAudio keeps a full-length url unchanged (no search)", async () => {
  let searched = false;
  axiosMock.setHandler(() => {
    searched = true;
    return Promise.resolve({ data: { data: songData } });
  });
  const out = await resolver.resolvePlayableAudio({
    name: "Vaathi Coming",
    artist: "Anirudh",
    audioUrl: "https://cdn.example/full.mp3",
    duration: 212,
  });
  assert.strictEqual(out.audioUrl, "https://cdn.example/full.mp3");
  assert.strictEqual(out.duration, 212);
  assert.strictEqual(searched, false);
});

test("resolvePlayableAudio keeps the original when no full copy exists", async () => {
  axiosMock.respond({ data: { results: [] } });
  const out = await resolver.resolvePlayableAudio({
    name: "Some Obscure Track",
    artist: "Nobody",
    audioUrl: "https://p.scdn.co/mp3-preview/xyz",
    duration: 150,
  });
  assert.strictEqual(out.audioUrl, "https://p.scdn.co/mp3-preview/xyz");
  assert.strictEqual(out.duration, 150);
});

test("resolveSaavnOnly resolves a preview from Saavn", async () => {
  axiosMock.setHandler((path) => {
    assert.match(path, /search\/songs/);
    return Promise.resolve({ data: { data: songData } });
  });
  const out = await resolver.resolveSaavnOnly({
    name: "Vaathi Coming",
    artist: "Anirudh",
    audioUrl: "https://p.scdn.co/mp3-preview/xyz",
    duration: 150,
  });
  assert.strictEqual(out.audioUrl, "https://cdn.example/full.mp3");
});

test("resolveSaavnOnly keeps the original when Saavn misses", async () => {
  axiosMock.respond({ data: { results: [] } });
  const out = await resolver.resolveSaavnOnly({
    name: "Unfindable Track",
    artist: "Nobody",
    audioUrl: "https://p.scdn.co/mp3-preview/xyz",
    duration: 150,
  });
  assert.strictEqual(out.audioUrl, "https://p.scdn.co/mp3-preview/xyz");
  assert.strictEqual(out.duration, 150);
});