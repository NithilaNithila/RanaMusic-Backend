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

const SESSION_BODY = {
  playParams: { id: "mrn:1.0:catalog:track:asin:B084KVZP2G" },
  playbackOptions: { shuffleMode: "SHUFFLE_OFF", loopMode: "LOOP_OFF" },
  limit: 3,
};

const SESSION_DATA = { entities: [{ sessionId: "s1", track: { id: "t1" } }], metadata: {} };

test("createPlaybackSession posts the playParams body and returns data", async () => {
  let seen = null;
  axiosMock.setHandler((path, config) => {
    seen = { path, method: config && config.method, body: config && config.data };
    return Promise.resolve({ data: { success: true, data: SESSION_DATA } });
  });
  const out = await amazon.createPlaybackSession(SESSION_BODY);
  assert.equal(seen.path, "/playback/sessions");
  assert.equal(seen.method, "post");
  assert.deepEqual(seen.body, SESSION_BODY);
  assert.deepEqual(out, SESSION_DATA);
});

test("getPlaybackCurrent hits the session path and returns the playback data", async () => {
  axiosMock.setHandler((path) => {
    assert.equal(path, "/playback/sessions/abc/current");
    return Promise.resolve({ data: { success: true, data: SESSION_DATA } });
  });
  const out = await amazon.getPlaybackCurrent("abc");
  assert.deepEqual(out, SESSION_DATA);
});

test("getPlaybackNext forwards a clamped limit query param", async () => {
  let seenParams = null;
  axiosMock.setHandler((path, config) => {
    seenParams = config && config.params;
    return Promise.resolve({ data: { success: true, data: SESSION_DATA } });
  });
  await amazon.getPlaybackNext("abc", 3);
  assert.deepEqual(seenParams, { limit: 3 });
  await amazon.getPlaybackNext("abc");
  assert.deepEqual(seenParams, {});
});

test("restore playback session nests entityReferenceId in the path", async () => {
  let seen = null;
  axiosMock.setHandler((path) => {
    seen = path;
    return Promise.resolve({ data: { success: true, data: { entities: [] } } });
  });
  await amazon.restorePlaybackSession("abc", "ref-9", 2);
  assert.equal(seen, "/playback/sessions/abc/entities/ref-9");
});

test("queue next/last send a raw body", async () => {
  const bodies = [];
  axiosMock.setHandler((path, config) => {
    bodies.push({ path, body: config && config.data, method: config && config.method });
    return Promise.resolve({ data: { success: true, data: {} } });
  });
  const playParams = { playParams: { id: "mrn:1.0:catalog:track:asin:B084KPC3Q7" } };
  await amazon.queuePlaybackNext("abc", playParams);
  await amazon.queuePlaybackLast("abc", playParams);
  assert.equal(bodies[0].path, "/playback/sessions/abc/queue/next");
  assert.equal(bodies[1].path, "/playback/sessions/abc/queue/last");
  assert.equal(bodies[0].method, "post");
  assert.deepEqual(bodies[0].body, playParams);
});

test("set loop/shuffle use PUT", async () => {
  let seen = null;
  axiosMock.setHandler((path, config) => {
    seen = { path, method: config && config.method, body: config && config.data };
    return Promise.resolve({ data: { success: true, data: {} } });
  });
  await amazon.setPlaybackLoop("abc", { loopMode: "LOOP_ALL" });
  assert.equal(seen.path, "/playback/sessions/abc/loop");
  assert.equal(seen.method, "put");
  assert.deepEqual(seen.body, { loopMode: "LOOP_ALL" });
});

test("report event posts to /playback/event", async () => {
  let seen = null;
  axiosMock.setHandler((path, config) => {
    seen = { path, method: config && config.method, body: config && config.data };
    return Promise.resolve({ data: { success: true, data: {} } });
  });
  const body = { metricId: "{}", event: { type: "start" } };
  await amazon.reportPlaybackEvent(body);
  assert.equal(seen.path, "/playback/event");
  assert.equal(seen.method, "post");
  assert.deepEqual(seen.body, body);
});

test("playback mutation reflects an upstream 4xx (e.g. concurrency 422)", async () => {
  axiosMock.setHandler(() => {
    const err = new Error("MAX_CONCURRENCY_REACHED");
    err.isAxiosError = true;
    err.response = { status: 422, data: { message: "Maximum concurrent listening" } };
    return Promise.reject(err);
  });
  await assert.rejects(amazon.reportPlaybackEvent(SESSION_BODY), /Maximum concurrent listening/);
});

test("playback proxy throws on mirror success:false", async () => {
  axiosMock.setHandler(() =>
    Promise.resolve({ data: { success: false, status: 409, message: "Playback session expired" } })
  );
  await assert.rejects(amazon.getPlaybackCurrent("gone"), /Playback session expired/);
});

test("playback proxy fails cleanly when the mirror is unreachable", async () => {
  axiosMock.setHandler(() => {
    const err = new Error("ECONNREFUSED");
    err.isAxiosError = true;
    return Promise.reject(err);
  });
  await assert.rejects(amazon.createPlaybackSession(SESSION_BODY), /unreachable/);
});