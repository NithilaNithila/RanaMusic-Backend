const { test } = require("node:test");
const assert = require("node:assert");

process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";

const redis = require("../src/services/redis.service");

test("redis service is disabled without credentials", () => {
  assert.strictEqual(redis.enabled, false);
});

test("redis getJson resolves undefined when disabled", async () => {
  assert.strictEqual(await redis.getJson("some:key"), undefined);
});

test("redis setJson returns false when disabled", async () => {
  assert.strictEqual(await redis.setJson("some:key", { a: 1 }, 600), false);
});

test("redis delKey is a no-op when disabled", async () => {
  assert.strictEqual(await redis.delKey("some:key"), undefined);
});