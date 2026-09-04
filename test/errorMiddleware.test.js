const { test } = require("node:test");
const assert = require("node:assert");
const { notFound, errorHandler } = require("../src/middleware/error.middleware");

const mk = () => {
  const res = {
    status(c) {
      this.sc = c;
      return this;
    },
    json(o) {
      this.js = o;
      return this;
    },
  };
  const req = { id: "req-1", originalUrl: "/api/x", method: "GET" };
  return { res, req };
};

test("notFound builds a 404 error and forwards it", () => {
  const { req, res } = mk();
  let nextErr = null;
  notFound(req, res, (e) => {
    nextErr = e;
  });
  assert.strictEqual(nextErr.statusCode, 404);
  assert.match(nextErr.message, /\/api\/x/);
});

test("errorHandler returns 500 for a generic error without exposing stack in response", () => {
  process.env.NODE_ENV = "development";
  const { req, res } = mk();
  errorHandler(new Error("boom"), req, res, () => {});
  assert.strictEqual(res.sc, 500);
  assert.strictEqual(res.js.message, "boom");
  assert.strictEqual(res.js.errors, null);
});

test("errorHandler maps Mongoose CastError to 400", () => {
  process.env.NODE_ENV = "test";
  const { req, res } = mk();
  const err = new Error("cast");
  err.name = "CastError";
  err.path = "playlistId";
  errorHandler(err, req, res, () => {});
  assert.strictEqual(res.sc, 400);
  assert.match(res.js.message, /Invalid value provided/);
});

test("errorHandler maps duplicate key to 409", () => {
  process.env.NODE_ENV = "test";
  const { req, res } = mk();
  const err = new Error("dup");
  err.code = 11000;
  err.keyValue = { username: "x" };
  errorHandler(err, req, res, () => {});
  assert.strictEqual(res.sc, 409);
  assert.match(res.js.message, /Duplicate value provided/);
});

test("errorHandler maps ValidationError to 400 with joined messages", () => {
  process.env.NODE_ENV = "test";
  const { req, res } = mk();
  const err = new Error("val");
  err.name = "ValidationError";
  err.errors = [{ message: "a" }, { message: "b" }];
  errorHandler(err, req, res, () => {});
  assert.strictEqual(res.sc, 400);
  assert.strictEqual(res.js.message, "a, b");
});

test("errorHandler maps axios 404 to 404 Resource not found", () => {
  process.env.NODE_ENV = "test";
  const { req, res } = mk();
  const err = new Error("ax");
  err.isAxiosError = true;
  err.response = { status: 404 };
  errorHandler(err, req, res, () => {});
  assert.strictEqual(res.sc, 404);
  assert.strictEqual(res.js.message, "Resource not found");
});

test("errorHandler maps axios 5xx to 502 Upstream service error", () => {
  process.env.NODE_ENV = "test";
  const { req, res } = mk();
  const err = new Error("ax");
  err.isAxiosError = true;
  err.response = { status: 502 };
  errorHandler(err, req, res, () => {});
  assert.strictEqual(res.sc, 502);
  assert.strictEqual(res.js.message, "Upstream service error");
});

test("errorHandler maps axios 429 to 429 Upstream request failed", () => {
  process.env.NODE_ENV = "test";
  const { req, res } = mk();
  const err = new Error("ax");
  err.isAxiosError = true;
  err.response = { status: 429 };
  errorHandler(err, req, res, () => {});
  assert.strictEqual(res.sc, 429);
  assert.strictEqual(res.js.message, "Upstream request failed");
});

test("errorHandler maps axios network error to 502 unreachable", () => {
  process.env.NODE_ENV = "test";
  const { req, res } = mk();
  const err = new Error("ax");
  err.isAxiosError = true;
  err.response = undefined;
  errorHandler(err, req, res, () => {});
  assert.strictEqual(res.sc, 502);
  assert.strictEqual(res.js.message, "Upstream service unreachable");
});

test("errorHandler maps err.status >= 500 to 502 upstream error", () => {
  process.env.NODE_ENV = "test";
  const { req, res } = mk();
  const err = new Error("up");
  err.status = 503;
  errorHandler(err, req, res, () => {});
  assert.strictEqual(res.sc, 502);
  assert.strictEqual(res.js.message, "Upstream service error");
});
