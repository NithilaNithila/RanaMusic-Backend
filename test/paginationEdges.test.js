const { test } = require("node:test");
const assert = require("node:assert");
const pagination = require("../src/utils/pagination");

test("sanitizePagination clamps negative page to 0 and 0-page default", () => {
  const out = pagination.sanitizePagination({ page: -5, limit: 10 });
  assert.strictEqual(out.page, 0);
  assert.strictEqual(out.limit, 10);
});

test("sanitizePagination defaults page/limit when absent", () => {
  const out = pagination.sanitizePagination({});
  assert.strictEqual(out.page, 0);
  assert.strictEqual(out.limit, 20);
});

test("resolvePageOffset treats empty-string offset as absent and defaults page to 1", () => {
  const out = pagination.resolvePageOffset({ offset: "", limit: 10 });
  assert.strictEqual(out.page, 1);
  assert.strictEqual(out.offset, 0);
});

test("resolvePageOffset computes page from offset", () => {
  const out = pagination.resolvePageOffset({ offset: 25, limit: 10 });
  assert.strictEqual(out.page, 3);
  assert.strictEqual(out.offset, 25);
});

test("resolvePageOffset defaults page to 1 when parsing fails and 0 offset", () => {
  const out = pagination.resolvePageOffset({ page: "abc" });
  assert.strictEqual(out.page, 1);
  assert.strictEqual(out.offset, 0);
});

test("paginatedPayload computes hasMore false at the last page", () => {
  const out = pagination.paginatedPayload({ results: [], total: 20, page: 2, limit: 10 });
  assert.strictEqual(out.hasMore, false);
});
