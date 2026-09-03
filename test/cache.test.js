const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const {
  getCache,
  setCache,
  delCache,
  makeCacheKey,
  memoize,
  cache,
} = require("../src/services/cache.service");

beforeEach(() => {
  cache.flushAll();
});

test("setCache/getCache round-trips, with and without ttl", () => {
  setCache("a", { x: 1 });
  assert.deepStrictEqual(getCache("a"), { x: 1 });

  setCache("b", 42, 100);
  assert.strictEqual(getCache("b"), 42);
});

test("getCache returns undefined for a miss", () => {
  assert.strictEqual(getCache("nope"), undefined);
});

test("delCache removes the value", () => {
  setCache("k", "v");
  delCache("k");
  assert.strictEqual(getCache("k"), undefined);
});

test("makeCacheKey sorts params into a stable key", () => {
  assert.strictEqual(makeCacheKey("pool", { lang: "hi", page: 1 }), "pool:lang=hi&page=1");
  assert.strictEqual(makeCacheKey("pool", { page: 1, lang: "hi" }), "pool:lang=hi&page=1");
  assert.strictEqual(makeCacheKey("bare"), "bare:");
});

test("memoize caches the loaded value", async () => {
  let calls = 0;
  const loader = () => {
    calls += 1;
    return Promise.resolve("value");
  };
  const first = await memoize("m:1", 600, loader);
  const second = await memoize("m:1", 600, loader);
  assert.strictEqual(first, "value");
  assert.strictEqual(second, "value");
  assert.strictEqual(calls, 1);
});

test("memoize returns instantly from cache without calling loader", async () => {
  setCache("m:2", "cached");
  let called = false;
  const out = await memoize("m:2", 600, () => {
    called = true;
    return Promise.resolve("fresh");
  });
  assert.strictEqual(out, "cached");
  assert.strictEqual(called, false);
});

test("memoize shares the in-flight promise for concurrent identical loads", async () => {
  let started = 0;
  let resolveAll;
  const gate = new Promise((r) => {
    resolveAll = r;
  });
  const loader = () => {
    started += 1;
    return gate.then(() => "shared");
  };
  const p1 = memoize("m:3", 600, loader);
  const p2 = memoize("m:3", 600, loader);
  resolveAll();
  assert.strictEqual(await p1, "shared");
  assert.strictEqual(await p2, "shared");
  assert.strictEqual(started, 1);
});

test("memoize does not cache failures and lets the next call retry", async () => {
  let calls = 0;
  const loader = () => {
    calls += 1;
    if (calls === 1) return Promise.reject(new Error("boom"));
    return Promise.resolve("ok");
  };
  await assert.rejects(memoize("m:4", 600, loader), /boom/);
  assert.strictEqual(getCache("m:4"), undefined);
  const out = await memoize("m:4", 600, loader);
  assert.strictEqual(out, "ok");
  assert.strictEqual(calls, 2);
});
