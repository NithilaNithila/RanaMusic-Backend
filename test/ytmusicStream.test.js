const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { EventEmitter, Readable, Writable } = require("node:stream");

const SERVICE_PATH = require.resolve("../src/services/ytmusic.service");
const CONTROLLER_PATH = require.resolve("../src/controllers/ytmusic.controller");

let stub = null;

const makeChild = ({ stdout = "", exitCode = 0 } = {}) => {
  const child = new EventEmitter();
  child.stdout = Readable.from([Buffer.from(String(stdout))]);
  child.stderr = Readable.from([Buffer.from("")]);
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  let ended = 0;
  const maybeClose = () => {
    if (++ended === 2) child.emit("close", exitCode);
  };
  child.stdout.on("end", maybeClose);
  child.stderr.on("end", maybeClose);
  return child;
};

const makeRes = () => {
  const chunks = [];
  const res = new Writable({
    write(chunk, enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  res.chunks = chunks;
  res._headers = {};
  res.jsonBody = null;
  res.setHeader = (k, v) => {
    res._headers[k] = v;
  };
  res.flushHeaders = () => {
    res.headersSent = true;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.jsonBody = body;
    res.headersSent = true;
  };
  return res;
};

let req;
const loadController = () => {
  delete require.cache[SERVICE_PATH];
  delete require.cache[CONTROLLER_PATH];
  require.cache[SERVICE_PATH] = {
    id: SERVICE_PATH,
    filename: SERVICE_PATH,
    loaded: true,
    exports: stub,
  };
  return require(CONTROLLER_PATH);
};

beforeEach(() => {
  stub = {
    isEnabled: () => true,
    isBreakerOpen: () => false,
    getTrackInfo: async () => ({
      id: "dQw4w9WgXcQ",
      contentType: "audio/webm",
      duration: 213,
    }),
    spawnStream: () => makeChild({ stdout: "audio-bytes", exitCode: 0 }),
  };
  req = {};
  req.on = () => req;
});

afterEach(() => {
  delete require.cache[SERVICE_PATH];
  delete require.cache[CONTROLLER_PATH];
});

test("rejects a malformed video id with 400", async () => {
  const controller = loadController();
  const res = makeRes();
  req.params = { id: "not-valid" };
  await controller.stream(req, res);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.jsonBody.success, false);
});

test("returns 503 when streaming is disabled", async () => {
  stub.isEnabled = () => false;
  const controller = loadController();
  const res = makeRes();
  req.params = { id: "dQw4w9WgXcQ" };
  await controller.stream(req, res);
  assert.strictEqual(res.statusCode, 503);
});

test("returns 503 while the circuit breaker is open", async () => {
  stub.isBreakerOpen = () => true;
  const controller = loadController();
  const res = makeRes();
  req.params = { id: "dQw4w9WgXcQ" };
  await controller.stream(req, res);
  assert.strictEqual(res.statusCode, 503);
});

test("surfaces the upstream status from getTrackInfo (403 bot check)", async () => {
  stub.getTrackInfo = async () => {
    const err = new Error("YouTube is requesting a bot check");
    err.status = 403;
    throw err;
  };
  const controller = loadController();
  const res = makeRes();
  req.params = { id: "dQw4w9WgXcQ" };
  await controller.stream(req, res);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.jsonBody.success, false);
});

test("search requires q and returns the requested per-type bucket", async () => {
  const controller = loadController();
  const bad = makeRes();
  req.query = { type: "artist" };
  await controller.search(req, bad);
  assert.strictEqual(bad.statusCode, 400);

  stub.search = async () => ({
    total: 3,
    results: { track: [], album: [], artist: [{ id: "UCT4pLbOXS_SZydXX-516YgQ", name: "Ilayaraja", type: "artist" }], playlist: [] },
  });
  const res = makeRes();
  req.query = { q: "ilayaraja", type: "artist" };
  await controller.search(req, res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.jsonBody.data.artist.length, 1);
  assert.strictEqual(res.jsonBody.data.artist[0].id, "UCT4pLbOXS_SZydXX-516YgQ");
});

test("pipes audio bytes with the resolved content type", async () => {
  const controller = loadController();
  const res = makeRes();
  req.params = { id: "dQw4w9WgXcQ" };
  req.on = () => req;
  await controller.stream(req, res);
  await new Promise((resolve) => {
    if (res.writableFinished) return resolve();
    res.on("finish", resolve);
  });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res._headers["Content-Type"], "audio/webm");
  // The stream is consumed cross-origin by the <audio> element (frontend port
  // vs backend port). Helmet's global CORP is overridden here so Chrome
  // doesn't block the media fetch ("no sound" despite the server streaming).
  assert.strictEqual(res._headers["Cross-Origin-Resource-Policy"], "cross-origin");
  assert.strictEqual(Buffer.concat(res.chunks).toString(), "audio-bytes");
});