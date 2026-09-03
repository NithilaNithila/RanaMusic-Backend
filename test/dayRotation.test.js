const { test } = require("node:test");
const assert = require("node:assert");
const { getDayIndex, pick, pickBlocks } = require("../src/utils/dayRotation");

test("pick cycles deterministically by day", () => {
  const list = ["a", "b", "c"];
  const day = getDayIndex();
  assert.strictEqual(pick(list), list[day % list.length]);
  // Two calls in the same day return the same entry.
  assert.strictEqual(pick(list), pick(list));
});

test("pickBlocks returns the configured number of entries rotating by day", () => {
  const list = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const out = pickBlocks(list, 4, 2); // 2 blocks of 4
  assert.strictEqual(out.length, 8);
  assert.strictEqual(new Set(out).size, 8);
});

test("pickBlocks returns empty for empty list or zero blocks", () => {
  assert.deepStrictEqual(pickBlocks([], 4, 2), []);
  assert.deepStrictEqual(pickBlocks(["a"], 4, 0), []);
});
