const { logger } = require("./logger.service");

const timeoutMs = Number(process.env.UPSTASH_REDIS_TIMEOUT_MS || 100);
let warned = false;

const isEnabled = () =>
  Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

const warnOnce = (label, err) => {
  if (warned) return;
  warned = true;
  logger.warn(
    { label, err: { message: err && err.message } },
    "Redis unavailable; falling back to the in-memory cache"
  );
};

const command = async (args) => {
  if (!isEnabled()) return undefined;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === "function") timer.unref();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      warnOnce("http", new Error(`status ${res.status}`));
      return undefined;
    }
    const data = await res.json();
    return data && data.result;
  } catch (err) {
    clearTimeout(timer);
    warnOnce("call", err);
    return undefined;
  }
};

const getJson = async (key) => {
  const raw = await command(["GET", key]);
  if (raw === undefined || raw === null || raw === "") return undefined;
  try {
    return JSON.parse(String(raw));
  } catch {
    return undefined;
  }
};

const setJson = async (key, value, ttlSeconds) => {
  if (!isEnabled()) return false;
  const args = ["SET", key, JSON.stringify(value)];
  if (ttlSeconds) args.push("EX", String(Math.floor(ttlSeconds)));
  const result = await command(args);
  return result !== undefined;
};

const delKey = async (key) => {
  await command(["DEL", key]);
};

module.exports = {
  get enabled() {
    return isEnabled();
  },
  getJson,
  setJson,
  delKey,
};