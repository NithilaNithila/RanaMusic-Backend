const { test } = require("node:test");
const assert = require("node:assert");
const { sanitizePagination, resolvePageOffset, paginatedPayload } = require("../src/utils/pagination");

test("sanitizePagination keeps 0-based page default for Saavn services", () => {
  assert.deepStrictEqual(sanitizePagination({}), { page: 0, limit: 20 });
  assert.deepStrictEqual(sanitizePagination({ page: 2, limit: 10 }), { page: 2, limit: 10 });
  assert.deepStrictEqual(sanitizePagination({ page: -5, limit: 1000 }), { page: 0, limit: 50 });
  assert.deepStrictEqual(sanitizePagination({ page: "abc", limit: 0 }), { page: 0, limit: 20 });
});

test("resolvePageOffset handles page-only input (1-based)", () => {
  const r = resolvePageOffset({ page: "3", limit: "10" });
  assert.strictEqual(r.page, 3);
  assert.strictEqual(r.offset, 20);
  assert.strictEqual(r.limit, 10);
});

test("resolvePageOffset handles offset-only input", () => {
  const r = resolvePageOffset({ offset: "25", limit: "10" });
  assert.strictEqual(r.offset, 25);
  assert.strictEqual(r.page, 3);
  assert.strictEqual(r.limit, 10);
});

test("resolvePageOffset returns safe defaults for empty input", () => {
  const r = resolvePageOffset({}, 20);
  assert.strictEqual(r.page, 1);
  assert.strictEqual(r.offset, 0);
  assert.strictEqual(r.limit, 20);
});

test("resolvePageOffset clamps limit to max", () => {
  const r = resolvePageOffset({ limit: "9999" }, 60);
  assert.strictEqual(r.limit, 60);
});

test("paginatedPayload computes hasMore correctly", () => {
  assert.strictEqual(paginatedPayload({ results: [], total: 25, page: 1, limit: 10 }).hasMore, true);
  assert.strictEqual(paginatedPayload({ results: [], total: 25, page: 3, limit: 10 }).hasMore, false);
  assert.strictEqual(paginatedPayload({ results: [], total: 25, page: 2, limit: 10 }).hasMore, true);
});
