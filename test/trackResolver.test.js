const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const axiosMock = require("./helpers/mockAxios");
const { cache } = require("../src/services/cache.service");

let resolver;

// The resolver pulls in the real ytmusic.service, which would spawn yt-dlp in
// tests. Stub it (default: disabled) so Saavn-only behavior is the baseline,
// then flip per-test to exercise the YouTube gap-fill.
const SERVICE_PATH = require.resolve("../src/services/ytmusic.service");
const RESOLVER_PATH = require.resolve("../src/services/trackResolver.service");
const ytStub = {
  _enabled: false,
  _breaker: false,
  _rows: [],
  _lastQuery: null,
  calls: { search: 0 },
  isEnabled: () => ytStub._enabled,
  isBreakerOpen: () => ytStub._breaker,
  search: async (query) => {
    ytStub.calls.search += 1;
    ytStub._lastQuery = query;
    return { total: ytStub._rows.length, results: { track: ytStub._rows } };
  },
};

// Builds a normalized ytmusic row the way ytmusic.service.search returns them.
const ytRow = (id, name, { artist = "", duration = 200, image = "" } = {}) => ({
  id,
  name,
  artist_name: artist,
  image,
  audio: `/api/ytmusic/songs/${id}/stream`,
  duration,
});

const installYtStub = () => {
  delete require.cache[SERVICE_PATH];
  require.cache[SERVICE_PATH] = {
    id: SERVICE_PATH,
    filename: SERVICE_PATH,
    loaded: true,
    exports: ytStub,
  };
};

beforeEach(() => {
  cache.flushAll();
  axiosMock.reset();
  axiosMock.install();
  ytStub._enabled = false;
  ytStub._breaker = false;
  ytStub._rows = [];
  ytStub._lastQuery = null;
  ytStub.calls.search = 0;
  installYtStub();
  // Load saavn first so the mock axios client is shared, then resolver.
  axiosMock.fresh("../src/services/saavn.service");
  delete require.cache[RESOLVER_PATH];
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

test("isPreviewAudioUrl treats a ytmusic stream url as already playable", () => {
  assert.strictEqual(
    resolver.isPreviewAudioUrl("/api/ytmusic/songs/dQw4w9WgXcQ/stream"),
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

test("resolvePlayableAudio uses Saavn first and never searches YouTube when Saavn matches", async () => {
  ytStub._enabled = true;
  ytStub._rows = [ytRow("dQw4w9WgXcQ", "Vaathi Coming", { artist: "Anirudh" })];
  axiosMock.setHandler(() => Promise.resolve({ data: { data: songData } }));
  const out = await resolver.resolvePlayableAudio({
    name: "Vaathi Coming",
    artist: "Anirudh",
    audioUrl: "https://p.scdn.co/mp3-preview/xyz",
    duration: 212,
  });
  assert.strictEqual(out.audioUrl, "https://cdn.example/full.mp3");
  assert.strictEqual(ytStub.calls.search, 0);
});

test("resolvePlayableAudio falls back to a YouTube stream when Saavn misses", async () => {
  ytStub._enabled = true;
  ytStub._rows = [
    ytRow("dQw4w9WgXcQ", "Some Obscure Track", {
      artist: "Nobody",
      image: "https://i.ytimg.com/x.jpg",
    }),
  ];
  axiosMock.respond({ data: { results: [] } });
  const out = await resolver.resolvePlayableAudio({
    name: "Some Obscure Track",
    artist: "Nobody",
    audioUrl: "https://p.scdn.co/mp3-preview/xyz",
    duration: 150,
  });
  assert.strictEqual(out.audioUrl, "/api/ytmusic/songs/dQw4w9WgXcQ/stream");
  assert.strictEqual(out.duration, 200);
  assert.strictEqual(ytStub.calls.search, 1);
});

test("resolvePlayableAudio skips YouTube when the breaker is open", async () => {
  ytStub._enabled = true;
  ytStub._breaker = true;
  ytStub._rows = [ytRow("dQw4w9WgXcQ", "Some Obscure Track", { artist: "Nobody" })];
  axiosMock.respond({ data: { results: [] } });
  const out = await resolver.resolvePlayableAudio({
    name: "Some Obscure Track",
    artist: "Nobody",
    audioUrl: "https://p.scdn.co/mp3-preview/xyz",
    duration: 150,
  });
  assert.strictEqual(out.audioUrl, "https://p.scdn.co/mp3-preview/xyz");
  assert.strictEqual(ytStub.calls.search, 0);
});

test("resolvePlayableAudio keeps the original when YouTube finds nothing", async () => {
  ytStub._enabled = true;
  ytStub._rows = [];
  axiosMock.respond({ data: { results: [] } });
  const out = await resolver.resolvePlayableAudio({
    name: "Some Obscure Track",
    artist: "Nobody",
    audioUrl: "https://p.scdn.co/mp3-preview/xyz",
    duration: 150,
  });
  assert.strictEqual(out.audioUrl, "https://p.scdn.co/mp3-preview/xyz");
  assert.strictEqual(ytStub.calls.search, 1);
});

test("findYtFullTrack rejects a mismatched title from YouTube Music", async () => {
  ytStub._enabled = true;
  ytStub._rows = [ytRow("dQw4w9WgXcQ", "Completely Different Song", { artist: "Nobody" })];
  const out = await resolver.findYtFullTrack({ name: "Some Obscure Track", artist: "Nobody" });
  assert.strictEqual(out, null);
});

// Regression for the reported "Rathinamo - Female Version" case: ytsearch1
// returns the BASE version first, so the old single-hit backstop rejected it
// and left the track unplayable. The multi-hit scorer must find the right
// version one result down and keep the base version only as a lower-ranked
// candidate.
test("findYtFullTrack picks the versioned hit when the base version ranks first", async () => {
  ytStub._enabled = true;
  ytStub._rows = [
    ytRow("baseVid", "Saurav Srisan - Rathinamo (Official Lyric Video)", { artist: "Saurav Srisan" }),
    ytRow("femaleVid", "Rathinamo (feat. Tanisha Gnanavel) (Female Version)", {
      artist: "Saurav Srisan",
      duration: 190,
    }),
  ];
  const out = await resolver.findYtFullTrack({
    name: "Rathinamo - Female Version",
    artist: "Saurav Srisan, Tanisha Gnanavel",
  });
  assert.strictEqual(out.audioUrl, "/api/ytmusic/songs/femaleVid/stream");
  assert.strictEqual(out.duration, 190);
  assert.match(ytStub._lastQuery, /Rathinamo/);
});

test("findYtFullTrack returns the base hit when no versioned copy exists", async () => {
  ytStub._enabled = true;
  ytStub._rows = [
    ytRow("baseVid", "Saurav Srisan - Rathinamo (Official Lyric Video)", { artist: "Saurav Srisan", duration: 190 }),
  ];
  const out = await resolver.findYtFullTrack({
    name: "Rathinamo",
    artist: "Saurav Srisan",
  });
  assert.strictEqual(out.audioUrl, "/api/ytmusic/songs/baseVid/stream");
});