const { test } = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const { requestLogger, randomRequestId } = require("../src/middleware/requestLogger.middleware");

const mk = (statusCode, user) => {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  const req = {
    method: "GET",
    originalUrl: "/api/x",
    ip: "127.0.0.1",
    user,
  };
  return { req, res };
};

test("attaches a request id and calls next immediately", () => {
  const { req, res } = mk(200);
  let nextCalled = false;
  requestLogger(req, res, () => {
    nextCalled = true;
  });
  assert.ok(req.id);
  assert.match(String(req.id), /^[0-9a-f]{16}$/);
  assert.strictEqual(nextCalled, true);
});

test("logs request complete on finish for a 200", () => {
  const { req, res } = mk(200, { _id: { toString: () => "u1" } });
  requestLogger(req, res, () => {});
  assert.doesNotThrow(() => res.emit("finish"));
});

test("logs request error on finish for a 500", () => {
  const { req, res } = mk(500);
  requestLogger(req, res, () => {});
  assert.doesNotThrow(() => res.emit("finish"));
});

test("logs request client error on finish for a 400", () => {
  const { req, res } = mk(400);
  requestLogger(req, res, () => {});
  assert.doesNotThrow(() => res.emit("finish"));
});

test("randomRequestId is a 16-hex string", () => {
  assert.match(randomRequestId(), /^[0-9a-f]{16}$/);
});
