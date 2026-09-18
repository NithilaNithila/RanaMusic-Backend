const { test } = require("node:test");
const assert = require("node:assert");
const { validId } = require("../src/utils/guardId");

test("validId accepts real string ids", () => {
  assert.strictEqual(validId("123abc"), true);
  assert.strictEqual(validId("  abc42 "), true);
});

test("validId rejects null, undefined, empty and missing ids", () => {
  assert.strictEqual(validId(null), false);
  assert.strictEqual(validId(undefined), false);
  assert.strictEqual(validId(""), false);
  assert.strictEqual(validId("   "), false);
  assert.strictEqual(validId(42), false);
});

test("validId rejects literal null/undefined strings produced by broken clients", () => {
  assert.strictEqual(validId("null"), false);
  assert.strictEqual(validId("NULL"), false);
  assert.strictEqual(validId("undefined"), false);
  assert.strictEqual(validId("Undefined"), false);
});