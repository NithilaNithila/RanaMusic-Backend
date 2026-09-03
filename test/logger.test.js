const { test } = require("node:test");
const assert = require("node:assert");
const { logger, randomRequestId } = require("../src/services/logger.service");

test("randomRequestId returns a 16-char hex id", () => {
  const id = randomRequestId();
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.notStrictEqual(id, randomRequestId());
});

test("logger exposes pino child/level methods", () => {
  assert.strictEqual(typeof logger.info, "function");
  assert.strictEqual(typeof logger.warn, "function");
  assert.strictEqual(typeof logger.error, "function");
  const child = logger.child({ reqId: "req-1" });
  assert.strictEqual(typeof child.info, "function");
});
