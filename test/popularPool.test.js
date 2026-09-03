const { test } = require("node:test");
const assert = require("node:assert");
const { aggregatePool, getPopularPool } = require("../src/utils/popularPool");

test("aggregatePool walks pages, dedupes, and stops on a short page", async () => {
  const calls = [];
  const searchFn = async (query, { page }) => {
    calls.push(page);
    if (page === 0) {
      return { results: [{ id: "a" }, { id: "b" }, { id: "a" }] }; // duplicate a
    }
    return { results: [{ id: "c" }] }; // short page -> stop after this
  };
  const out = await aggregatePool(searchFn, ["q1"], { pageSize: 3, maxPages: 5, cap: 100 });
  assert.deepStrictEqual(out.map((x) => x.id), ["a", "b", "c"]);
  assert.deepStrictEqual(calls, [0, 1]);
});

test("aggregatePool respects the cap and dedupes across pages", async () => {
  const all = Array.from({ length: 7 }, (_, i) => ({ id: `id${i}` }));
  const searchFn = async (query, { page }) => ({ results: all });
  const out = await aggregatePool(searchFn, ["q1"], { pageSize: 4, maxPages: 10, cap: 5 });
  assert.strictEqual(out.length, 5);
});

test("aggregatePool stops when the source is exhausted before hitting cap", async () => {
  const searchFn = async (query, { page }) => {
    if (page > 2) return { results: [] };
    return { results: [{ id: `p${page}` }] };
  };
  const out = await aggregatePool(searchFn, ["q1"], { pageSize: 1, maxPages: 50, cap: 100 });
  assert.deepStrictEqual(out.map((x) => x.id), ["p0", "p1", "p2"]);
});

test("aggregatePool skips items without ids", async () => {
  const searchFn = async () => ({ results: [{ name: "no id" }, { id: "ok" }] });
  const out = await aggregatePool(searchFn, ["q1"], { pageSize: 2, maxPages: 5, cap: 10 });
  assert.deepStrictEqual(out.map((x) => x.id), ["ok"]);
});

test("getPopularPool memoizes the built pool across calls", async () => {
  let buildCount = 0;
  const searchFn = async () => {
    buildCount += 1;
    return { results: [{ id: "a" }, { id: "b" }] };
  };
  const pool = await getPopularPool({ poolPrefix: "t", lang: "hi", searchFn, queryList: ["q"] });
  const again = await getPopularPool({ poolPrefix: "t", lang: "hi", searchFn, queryList: ["q"] });
  assert.strictEqual(pool.length, 2);
  assert.strictEqual(again.length, 2);
  assert.strictEqual(buildCount, 1);
});
