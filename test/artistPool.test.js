const { test, afterEach, beforeEach } = require("node:test");
const assert = require("node:assert");
const axiosMock = require("./helpers/mockAxios");
const { cache } = require("../src/services/cache.service");

let getArtistPool;

beforeEach(() => {
  cache.flushAll();
  axiosMock.reset();
  axiosMock.install();
  // Load fresh so the module-level artistPoolCache resets between tests.
  getArtistPool = axiosMock.fresh("../src/utils/artistPool").getArtistPool;
});

afterEach(() => {
  axiosMock.restore();
});

const seedResult = (id, image) => ({ id, name: `Artist ${id}`, image });

test("getArtistPool sorts imageless artists last", async () => {
  let query = "";
  axiosMock.setHandler((path, config) => {
    query = config ? config.params.query : query;
    return Promise.resolve({
      data: { data: { results: [seedResult("pop", "http://img"), seedResult("extra", "")] } },
    });
  });
  const pool = await getArtistPool("hi");
  const withImage = pool.findIndex((a) => a.id === "pop");
  const withoutImage = pool.findIndex((a) => a.id === "extra");
  assert.ok(withImage < withoutImage);
});

test("getArtistPool returns the cached frozen list on repeat calls", async () => {
  let calls = 0;
  axiosMock.setHandler((path, config) => {
    calls += 1;
    return Promise.resolve({ data: { data: { results: [seedResult("a", "http://i")] } } });
  });
  const first = await getArtistPool("en");
  const afterFirst = calls;
  const second = await getArtistPool("en");
  assert.deepStrictEqual(second, first);
  assert.strictEqual(calls, afterFirst); // served from module cache
});

test("getArtistPool tolerates upstream failures for a seed block", async () => {
  axiosMock.setHandler(() => Promise.reject(new Error("boom")));
  const pool = await getArtistPool("te");
  assert.deepStrictEqual(pool, []);
});
