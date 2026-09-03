const { test, before } = require("node:test");
const assert = require("node:assert");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "unit-test-secret";
process.env.JWT_ISSUER = "test-issuer";
process.env.JWT_AUDIENCE = "test-audience";

let generateToken;

before(() => {
  generateToken = require("../src/utils/generateToken");
});

test("generated token carries id, jti, iss, aud and verifies with HS256", () => {
  const token = generateToken("abc123");
  const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
  assert.strictEqual(decoded.id, "abc123");
  assert.ok(decoded.jti, "jti should be set");
  assert.strictEqual(decoded.iss, "test-issuer");
  assert.strictEqual(decoded.aud, "test-audience");
});

test("token is rejected with a different secret", () => {
  const token = generateToken("abc123");
  assert.throws(() => jwt.verify(token, "wrong-secret", { algorithms: ["HS256"] }));
});

test("expired token is rejected", () => {
  const bad = jwt.sign({ id: "x" }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "-1s" });
  assert.throws(() => jwt.verify(bad, process.env.JWT_SECRET, { algorithms: ["HS256"] }), /expired/i);
});

test("expired password-reset token is rejected", () => {
  const bad = jwt.sign({ sub: "u1", type: "password-reset" }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "-1s" });
  assert.throws(() => jwt.verify(bad, process.env.JWT_SECRET, { algorithms: ["HS256"] }));
});
