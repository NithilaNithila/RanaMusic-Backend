const { test } = require("node:test");
const assert = require("node:assert");
const ApiResponse = require("../src/utils/apiResponse");

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
  return res;
};

test("success returns 200 with success/message/data", () => {
  const res = mk();
  const out = ApiResponse.success(res, { a: 1 }, "Done");
  assert.strictEqual(out.sc, 200);
  assert.strictEqual(out.js.success, true);
  assert.strictEqual(out.js.message, "Done");
  assert.deepStrictEqual(out.js.data, { a: 1 });
});

test("success honors custom status code and default args", () => {
  const res = mk();
  ApiResponse.success(res, [], "Created", 201);
  assert.strictEqual(res.sc, 201);
  assert.deepStrictEqual(res.js.data, []);
});

test("error returns 500 by default with errors field", () => {
  const res = mk();
  ApiResponse.error(res);
  assert.strictEqual(res.sc, 500);
  assert.strictEqual(res.js.success, false);
  assert.strictEqual(res.js.message, "Something went wrong");
  assert.strictEqual(res.js.errors, null);
});

test("error honors message/status/errors", () => {
  const res = mk();
  ApiResponse.error(res, "nope", 400, ["bad"]);
  assert.strictEqual(res.sc, 400);
  assert.strictEqual(res.js.message, "nope");
  assert.deepStrictEqual(res.js.errors, ["bad"]);
});
