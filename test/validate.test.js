const { test } = require("node:test");
const assert = require("node:assert");
const validate = require("../src/middleware/validate.middleware");

const mk = (body) => {
  const req = { body };
  const res = {
    status(c) { this.sc = c; return this; },
    json(o) { this.js = o; return this; },
  };
  const next = () => { res.calledNext = true; };
  return { req, res, next };
};

const run = (fields, overrides, body) => {
  const { req, res, next } = mk(body);
  validate(fields, overrides)(req, res, next);
  return res;
};

test("passes valid input to next()", () => {
  const res = run(["email", "password"], {}, { email: "a@b.com", password: "123456" });
  assert.strictEqual(res.calledNext, true);
  assert.strictEqual(res.sc, undefined);
});

test("rejects missing field", () => {
  const res = run(["email"], {}, {});
  assert.strictEqual(res.sc, 400);
  assert.match(res.js.message, /email/);
});

test("rejects malformed email", () => {
  const res = run(["email"], {}, { email: "not-an-email" });
  assert.strictEqual(res.sc, 400);
  assert.match(res.js.message, /Invalid email/);
});

test("rejects out-of-range string length", () => {
  const res = run(["password"], {}, { password: "123" });
  assert.strictEqual(res.sc, 400);
  assert.match(res.js.message, /Invalid length/);
});

test("rejects non-string field", () => {
  const res = run(["username"], {}, { username: 123 });
  assert.strictEqual(res.sc, 400);
  assert.match(res.js.message, /must be strings/);
});

test("honors per-route overrides", () => {
  const res = run(["password"], { password: { min: 8 } }, { password: "1234567" });
  assert.strictEqual(res.sc, 400);
  assert.match(res.js.message, /Invalid length/);
});
