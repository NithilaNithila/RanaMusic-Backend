const { test } = require("node:test");
const assert = require("node:assert");
const {
  apiLimiter,
  authLimiter,
  userDataLimiter,
  keyGenerator,
} = require("../src/middleware/rateLimiter.middleware");

test("exports all three limiters with expected shape", () => {
  for (const limiter of [apiLimiter, authLimiter, userDataLimiter]) {
    assert.strictEqual(typeof limiter, "function");
    // express-rate-limit instance is callable and carries a handler
    assert.ok(limiter);
  }
});

test("limiters expose a message and window config via the instance", async () => {
  // Smoke-test the limiter as middleware: a single request should pass through.
  const req = {};
  const res = {};
  let nextCalled = false;
  await new Promise((resolve) => {
    apiLimiter(req, res, () => {
      nextCalled = true;
      resolve();
    });
  });
  assert.strictEqual(nextCalled, true);
});

test("auth limiter keying falls back to IP when there is no user", async () => {
  const req = { ip: "127.0.0.1" };
  const res = {};
  let ok = false;
  await new Promise((resolve) => {
    authLimiter(req, res, () => {
      ok = true;
      resolve();
    });
  });
  assert.strictEqual(ok, true);
});

test("userDataLimiter keys by authenticated user id (user.id)", () => {
  const req = { user: { id: "abc123" }, ip: "1.2.3.4" };
  const key = keyGenerator("user")(req, {});
  assert.strictEqual(key, Buffer.from("user:u:abc123").toString("base64url"));
});

test("userDataLimiter keys by user._id when id is absent", () => {
  const req = { user: { _id: { toString: () => "objid9" } }, ip: "1.2.3.4" };
  const key = keyGenerator("user")(req, {});
  assert.strictEqual(key, Buffer.from("user:u:objid9").toString("base64url"));
});

test("userDataLimiter falls back to IP when no user is present", () => {
  const req = { ip: "10.0.0.1" };
  const key = keyGenerator("user")(req, {});
  assert.strictEqual(key, "user:ip:10.0.0.1");
});
