const { test, afterEach, beforeEach } = require("node:test");
const assert = require("node:assert");

const MODULE = require.resolve("../src/middleware/auth.middleware");
const USER_MOD = require.resolve("../src/models/User");
const JWT_MOD = require.resolve("jsonwebtoken");

let jwtVerify = () => { throw new Error("verify not stubbed"); };
let userResult = null; // value findById resolves to; null throws "not found"
let findCalls = 0;

function install() {
  delete require.cache[USER_MOD];
  require.cache[USER_MOD] = {
    id: USER_MOD,
    filename: USER_MOD,
    loaded: true,
    exports: {
      findById: (id) => {
        findCalls += 1;
        return {
          select: () => ({ lean: () => (userResult === null ? Promise.resolve(null) : Promise.resolve(userResult)) }),
        };
      },
    },
  };
  delete require.cache[JWT_MOD];
  require.cache[JWT_MOD] = {
    id: JWT_MOD,
    filename: JWT_MOD,
    loaded: true,
    exports: { verify: (token, secret, opts) => jwtVerify(token, secret, opts) },
  };
}

function restore() {
  delete require.cache[USER_MOD];
  delete require.cache[JWT_MOD];
  delete require.cache[MODULE];
  require("jsonwebtoken");
}

let auth;

beforeEach(() => {
  process.env.JWT_SECRET = "test-secret";
  delete process.env.JWT_ISSUER;
  delete process.env.JWT_AUDIENCE;
  // Flush the shared in-memory cache so each test starts with a clean slate.
  require("../src/services/cache.service").cache.flushAll();
  install();
  auth = require(MODULE);
  findCalls = 0;
  userResult = undefined;
});

afterEach(() => {
  restore();
});

const makeRes = () => {
  const res = {
    _status: 200,
    status(c) { res._status = c; return res; },
    json() { return res; },
  };
  return res;
};

test("protect rejects a request with no token", async () => {
  const req = { headers: {} };
  const res = makeRes();
  let nextCalled = false;
  await auth.protect(req, res, () => { nextCalled = true; });
  assert.strictEqual(res._status, 401);
  assert.strictEqual(nextCalled, false);
});

test("protect rejects on invalid token", async () => {
  jwtVerify = () => { throw new Error("bad token"); };
  const req = { headers: { authorization: "Bearer bad" } };
  const res = makeRes();
  await auth.protect(req, res, () => {});
  assert.strictEqual(res._status, 401);
});

test("protect rejects when issuer/audience claims mismatch", async () => {
  jwtVerify = () => ({ id: "u1", iss: "other" });
  const req = { headers: { authorization: "Bearer tok" } };
  const res = makeRes();
  await auth.protect(req, res, () => {});
  assert.strictEqual(res._status, 401);
});

test("protect rejects when the user is not found in the DB", async () => {
  jwtVerify = () => ({ id: "u1" });
  userResult = null;
  const req = { headers: { authorization: "Bearer tok" } };
  const res = makeRes();
  await auth.protect(req, res, () => {});
  assert.strictEqual(res._status, 401);
});

test("protect sets req.user from DB and calls next", async () => {
  jwtVerify = () => ({ id: "u1" });
  userResult = { _id: "u1", name: "Tester" };
  const req = { headers: { authorization: "Bearer tok" } };
  const res = makeRes();
  let nextCalled = false;
  await auth.protect(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.user.name, "Tester");
  assert.strictEqual(findCalls, 1);
});

test("protect serves the user from the in-memory cache on a second call", async () => {
  jwtVerify = () => ({ id: "u1" });
  userResult = { _id: "u1", name: "Tester" };
  const res = makeRes();
  const req1 = { headers: { authorization: "Bearer tok" } };
  await auth.protect(req1, res, () => {});
  const req2 = { headers: { authorization: "Bearer tok" } };
  await auth.protect(req2, res, () => {});
  assert.strictEqual(findCalls, 1); // second call served from cache
});

test("optionalAuth leaves req.user unset when no token present", async () => {
  const req = { headers: {} };
  let nextCalled = false;
  await auth.optionalAuth(req, {}, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.user, undefined);
});

test("optionalAuth treats an invalid token as anonymous", async () => {
  jwtVerify = () => { throw new Error("expired"); };
  const req = { headers: { authorization: "Bearer expired" } };
  let nextCalled = false;
  await auth.optionalAuth(req, {}, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.user, undefined);
});

test("optionalAuth sets req.user from cache when a valid token is present", async () => {
  jwtVerify = () => ({ id: "u1" });
  userResult = { _id: "u1", name: "Tester" };
  const req = { headers: { authorization: "Bearer tok" } };
  let nextCalled = false;
  await auth.optionalAuth(req, {}, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.user.name, "Tester");
});

test("optionalAuth leaves req.user unset when the user is not found", async () => {
  jwtVerify = () => ({ id: "u1" });
  userResult = null;
  const req = { headers: { authorization: "Bearer tok" } };
  let nextCalled = false;
  await auth.optionalAuth(req, {}, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.user, undefined);
});

test("optionalAuth serves req.user from the in-memory cache", async () => {
  // Pre-populate the auth cache for a user WITHOUT going through findById.
  const { setCache, delCache } = require("../src/services/cache.service");
  delCache("auth:user:u1");
  setCache("auth:user:u1", { _id: "u1", name: "Cached" }, 60);
  jwtVerify = () => ({ id: "u1" });
  userResult = { _id: "u1", name: "ShouldNotLoad" };
  const req = { headers: { authorization: "Bearer tok" } };
  let nextCalled = false;
  await auth.optionalAuth(req, {}, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req.user.name, "Cached");
  assert.strictEqual(findCalls, 0); // served from cache, no DB call
});
