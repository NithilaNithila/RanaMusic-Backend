const { test } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const albumRoutes = require("../src/routes/album.routes");
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

test("album routes reject invalid ids before calling services", async () => {
  const app = express();
  app.use("/albums", albumRoutes);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    for (const path of ["/albums/null/tracks", "/albums/undefined"]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      const body = await response.json();
      assert.strictEqual(response.status, 400);
      assert.strictEqual(body.message, "Invalid album id");
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});