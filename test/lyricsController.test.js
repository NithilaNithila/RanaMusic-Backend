const { test, afterEach } = require("node:test");
const assert = require("node:assert");

const CONTROLLER = require.resolve("../src/controllers/lyrics.controller");

// Controllers are asyncHandler-wrapped, which discards the inner promise, so a
// handler with multiple awaits can resolve its response after the caller's
// `await` returns. A macrotask flush guarantees the inner work finished.
const flush = () => new Promise((resolve) => setImmediate(resolve));

const makeRes = () => {
  const res = {};
  res.statusCode = null;
  res.body = null;
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
};

const loadController = (stubs) => {
  for (const [modulePath, exports] of Object.entries(stubs)) {
    const resolved = require.resolve(modulePath);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  }
  delete require.cache[CONTROLLER];
  return require(CONTROLLER);
};

const STUB_PATHS = [
  require.resolve("../src/services/saavn.service"),
  require.resolve("../src/services/lrclib.service"),
  require.resolve("../src/services/lyricsovh.service"),
];

afterEach(() => {
  for (const p of STUB_PATHS) delete require.cache[p];
  delete require.cache[CONTROLLER];
});

test("default source chains saavn -> lrclib -> lyricsovh", async () => {
  const controller = loadController({
    "../src/services/saavn.service": { getLyricsByTitle: async () => null, getLyrics: async () => null },
    "../src/services/lrclib.service": { getLyrics: async () => "lrclib text" },
    "../src/services/lyricsovh.service": { getLyrics: async () => "ovh text" },
  });
  const res = makeRes();
  await controller.getLyricsByTitle({ query: { artist: "A", title: "T" } }, res);
  await flush();
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.data.source, "lrclib");
  assert.strictEqual(res.body.data.lyrics, "lrclib text");
});

test("default chain reaches last provider when earlier ones miss", async () => {
  const controller = loadController({
    "../src/services/saavn.service": { getLyricsByTitle: async () => null, getLyrics: async () => null },
    "../src/services/lrclib.service": { getLyrics: async () => null },
    "../src/services/lyricsovh.service": { getLyrics: async () => "ovh text" },
  });
  const res = makeRes();
  await controller.getLyricsByTitle({ query: { artist: "A", title: "T" } }, res);
  await flush();
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.data.source, "lyricsovh");
});

test("default chain returns 404 when every provider misses", async () => {
  const controller = loadController({
    "../src/services/saavn.service": { getLyricsByTitle: async () => null, getLyrics: async () => null },
    "../src/services/lrclib.service": { getLyrics: async () => null },
    "../src/services/lyricsovh.service": { getLyrics: async () => null },
  });
  const res = makeRes();
  await controller.getLyricsByTitle({ query: { artist: "A", title: "T" } }, res);
  await flush();
  assert.strictEqual(res.statusCode, 404);
});

test("explicit source skips the chain", async () => {
  let saavnCalls = 0;
  const controller = loadController({
    "../src/services/saavn.service": {
      getLyricsByTitle: async () => {
        saavnCalls += 1;
        return null;
      },
      getLyrics: async () => null,
    },
    "../src/services/lyricsovh.service": { getLyrics: async () => "ovh text" },
  });
  const res = makeRes();
  await controller.getLyricsByTitle({ query: { artist: "A", title: "T", source: "lyricsovh" } }, res);
  await flush();
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.data.source, "lyricsovh");
  assert.strictEqual(saavnCalls, 0);
});

test("unknown source still 400s", async () => {
  const controller = loadController({
    "../src/services/saavn.service": { getLyricsByTitle: async () => null, getLyrics: async () => null },
  });
  const res = makeRes();
  await controller.getLyricsByTitle({ query: { artist: "A", title: "T", source: "bogus" } }, res);
  await flush();
  assert.strictEqual(res.statusCode, 400);
});

test("missing artist/title still 400s before any lookup", async () => {
  const controller = loadController({
    "../src/services/saavn.service": { getLyricsByTitle: async () => null, getLyrics: async () => null },
  });
  const res = makeRes();
  await controller.getLyricsByTitle({ query: { artist: "A" } }, res);
  await flush();
  assert.strictEqual(res.statusCode, 400);
});

test("explicit saavn source behaves as before (single provider)", async () => {
  const controller = loadController({
    "../src/services/saavn.service": { getLyricsByTitle: async () => "saavn text", getLyrics: async () => null },
  });
  const res = makeRes();
  await controller.getLyricsByTitle({ query: { artist: "A", title: "T", source: "saavn" } }, res);
  await flush();
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.data.source, "saavn");
  assert.strictEqual(res.body.data.lyrics, "saavn text");
});