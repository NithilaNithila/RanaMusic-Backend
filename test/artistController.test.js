const { test, afterEach } = require("node:test");
const assert = require("node:assert");

const CONTROLLER = require.resolve("../src/controllers/artist.controller");
const SAAVN_SERVICE = require.resolve("../src/services/saavn.service");
const SPOTIFY_SERVICE = require.resolve("../src/services/spotify.service");

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

const run = async (handler, req, res) => {
  let nextError = null;
  handler(req, res, (err) => {
    nextError = err;
  });
  await flush();
  assert.ifError(nextError);
};

afterEach(() => {
  delete require.cache[CONTROLLER];
  delete require.cache[SAAVN_SERVICE];
  delete require.cache[SPOTIFY_SERVICE];
});

test("artist details default to saavn", async () => {
  let spotifyCalls = 0;
  const controller = loadController({
    "../src/services/saavn.service": {
      getArtistById: async (id) => ({ id, name: "Saavn Artist" }),
    },
    "../src/services/spotify.service": {
      getArtistById: async () => {
        spotifyCalls += 1;
        return null;
      },
    },
  });
  const res = makeRes();

  await run(controller.getArtistById, { params: { id: "ar1" }, query: {} }, res);

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.data.name, "Saavn Artist");
  assert.strictEqual(spotifyCalls, 0);
});

test("artist details use spotify when requested", async () => {
  let saavnCalls = 0;
  const controller = loadController({
    "../src/services/saavn.service": {
      getArtistById: async () => {
        saavnCalls += 1;
        return null;
      },
    },
    "../src/services/spotify.service": {
      getArtistById: async (id) => ({ id, name: "Spotify Artist" }),
    },
  });
  const res = makeRes();

  await run(
    controller.getArtistById,
    { params: { id: "ar2" }, query: { source: " Spotify " } },
    res
  );

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.data.name, "Spotify Artist");
  assert.strictEqual(saavnCalls, 0);
});

test("artist details reject an unknown source", async () => {
  let serviceCalls = 0;
  const controller = loadController({
    "../src/services/saavn.service": {
      getArtistById: async () => {
        serviceCalls += 1;
        return null;
      },
    },
    "../src/services/spotify.service": {
      getArtistById: async () => {
        serviceCalls += 1;
        return null;
      },
    },
  });
  const res = makeRes();

  await run(
    controller.getArtistById,
    { params: { id: "ar3" }, query: { source: "bogus" } },
    res
  );

  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(serviceCalls, 0);
  assert.strictEqual(res.body.message, "Unknown artist source 'bogus'. Supported: saavn, spotify");
});

test("spotify artist details return 404 when missing", async () => {
  const controller = loadController({
    "../src/services/saavn.service": {},
    "../src/services/spotify.service": { getArtistById: async () => null },
  });
  const res = makeRes();

  await run(
    controller.getArtistById,
    { params: { id: "missing" }, query: { source: "spotify" } },
    res
  );

  assert.strictEqual(res.statusCode, 404);
});

test("spotify artist albums receive pagination options", async () => {
  let received = null;
  let saavnCalls = 0;
  const controller = loadController({
    "../src/services/saavn.service": {
      getArtistAlbums: async () => {
        saavnCalls += 1;
        return { results: [] };
      },
    },
    "../src/services/spotify.service": {
      getArtistAlbums: async (id, options) => {
        received = { id, options };
        return { results: [{ id: "al1" }] };
      },
    },
  });
  const res = makeRes();

  await run(
    controller.getArtistAlbums,
    {
      params: { id: "ar4" },
      query: { source: "spotify", type: "single", limit: "5", page: "3" },
    },
    res
  );

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(received, {
    id: "ar4",
    options: { type: "single", limit: 5, offset: 10 },
  });
  assert.deepStrictEqual(res.body.data, [{ id: "al1" }]);
  assert.strictEqual(saavnCalls, 0);
});

test("spotify artist tracks use top tracks and forward market", async () => {
  let received = null;
  let saavnCalls = 0;
  const controller = loadController({
    "../src/services/saavn.service": {
      getArtistSongs: async () => {
        saavnCalls += 1;
        return { results: [] };
      },
    },
    "../src/services/spotify.service": {
      getArtistTopTracks: async (id, options) => {
        received = { id, options };
        return { results: [{ id: "tr1" }] };
      },
    },
  });
  const res = makeRes();

  await run(
    controller.getArtistTracks,
    { params: { id: "ar5" }, query: { source: "spotify", market: "IN" } },
    res
  );

  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(received, { id: "ar5", options: { market: "IN" } });
  assert.deepStrictEqual(res.body.data, [{ id: "tr1" }]);
  assert.strictEqual(saavnCalls, 0);
});
