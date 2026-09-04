const { test } = require("node:test");
const assert = require("node:assert");
const {
  recordFailure,
  clearFailures,
  getLockRemaining,
} = require("../src/utils/loginProtection");

test("no lock when there have been no failures", () => {
  assert.strictEqual(getLockRemaining("nobody@example.com"), null);
});

test("locks the account after MAX_FAILED_ATTEMPTS", () => {
  const email = "spam@example.com";
  for (let i = 0; i < 5; i++) recordFailure(email);
  const remaining = getLockRemaining(email);
  assert.equal(typeof remaining, "number");
  assert.ok(remaining > 0);
});

test("under the threshold does not lock", () => {
  const email = "attempts@example.com";
  recordFailure(email);
  recordFailure(email);
  assert.strictEqual(getLockRemaining(email), null);
});

test("clearFailures unlocks a previously locked account", () => {
  const email = "unlock@example.com";
  for (let i = 0; i < 5; i++) recordFailure(email);
  assert.ok(getLockRemaining(email) > 0);
  clearFailures(email);
  assert.strictEqual(getLockRemaining(email), null);
});

test("is case and whitespace insensitive", () => {
  const email = "CaseSpace@Example.com";
  recordFailure(email);
  assert.strictEqual(getLockRemaining("casespace@example.com "), null);
  for (let i = 0; i < 4; i++) recordFailure(email);
  assert.ok(getLockRemaining(" casespace@example.com") > 0);
});

test("records nothing for empty emails", () => {
  recordFailure("");
  recordFailure(null);
  recordFailure(undefined);
  assert.strictEqual(getLockRemaining(""), null);
});
