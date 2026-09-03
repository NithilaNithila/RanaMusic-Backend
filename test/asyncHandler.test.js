const { test } = require("node:test");
const assert = require("node:assert");
const asyncHandler = require("../src/utils/asyncHandler");

test("passes req/res/next to the wrapped fn", () => {
  let called = null;
  const fn = asyncHandler((req, res, next) => {
    called = { req, res, next };
  });
  const req = { x: 1 };
  const res = { y: 2 };
  const next = () => {};
  fn(req, res, next);
  assert.strictEqual(called.req, req);
  assert.strictEqual(called.res, res);
  assert.strictEqual(called.next, next);
});

test("forwards a rejected promise to next", async () => {
  let forwarded = null;
  const fn = asyncHandler(async () => {
    throw new Error("boom");
  });
  fn(null, null, (err) => {
    forwarded = err;
  });
  await Promise.resolve();
  assert.ok(forwarded instanceof Error);
  assert.strictEqual(forwarded.message, "boom");
});
