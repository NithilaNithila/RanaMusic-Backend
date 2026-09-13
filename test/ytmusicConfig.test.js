const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const CFG_PATH = require.resolve("../src/config/ytmusic");

// The config resolves env vars at require time, so each case re-requires a
// fresh module with the env shape it needs.
const loadConfig = ({ ytCookies, ytCookiesB64 }) => {
  if (ytCookies === undefined) delete process.env.YT_COOKIES;
  else process.env.YT_COOKIES = ytCookies;
  if (ytCookiesB64 === undefined) delete process.env.YT_COOKIES_B64;
  else process.env.YT_COOKIES_B64 = ytCookiesB64;
  delete require.cache[CFG_PATH];
  return require("../src/config/ytmusic");
};

const clearEnv = () => {
  delete process.env.YT_COOKIES;
  delete process.env.YT_COOKIES_B64;
  delete require.cache[CFG_PATH];
};

const COOKIE_LINE = "# Netscape HTTP Cookie File\nexample.com\tTRUE\t/\tFALSE\t0\tSID\tabc123\n";

test("YT_COOKIES_B64 decodes into a real cookies.txt temp file", () => {
  clearEnv();
  const b64 = Buffer.from(COOKIE_LINE, "utf8").toString("base64");
  const cfg = loadConfig({ ytCookies: "", ytCookiesB64: b64 });

  assert.ok(cfg.cookiesPath, "expected a cookies file path");
  assert.ok(path.basename(cfg.cookiesPath).includes("ranamusic-yt-cookies"));
  assert.ok(fs.existsSync(cfg.cookiesPath), "cookies file should exist");
  assert.ok(fs.readFileSync(cfg.cookiesPath, "utf8").includes("SID\tabc123"));
  clearEnv();
});

test("YT_COOKIES (real file path) wins over YT_COOKIES_B64", () => {
  clearEnv();
  const b64 = Buffer.from(COOKIE_LINE, "utf8").toString("base64");
  const cfg = loadConfig({ ytCookies: "/opt/cookies/yt.txt", ytCookiesB64: b64 });
  assert.strictEqual(cfg.cookiesPath, "/opt/cookies/yt.txt");
  clearEnv();
});

test("authenticated cookies switch the default player client to tv", () => {
  clearEnv();
  const b64 = Buffer.from(COOKIE_LINE, "utf8").toString("base64");
  const cfg = loadConfig({ ytCookies: "", ytCookiesB64: b64 });
  assert.strictEqual(cfg.playerClient, "tv");
  clearEnv();
});

test("without cookies the player client stays unset", () => {
  clearEnv();
  const cfg = loadConfig({ ytCookies: "", ytCookiesB64: "" });
  assert.strictEqual(cfg.playerClient, "");
  clearEnv();
});

test("cookiesPath is empty when neither YT_COOKIES nor YT_COOKIES_B64 is set", () => {
  clearEnv();
  const cfg = loadConfig({ ytCookies: "", ytCookiesB64: "" });
  assert.strictEqual(cfg.cookiesPath, "");
  clearEnv();
});

test("raw Netscape cookie text in YT_COOKIES_B64 is accepted as-is", () => {
  clearEnv();
  const cfg = loadConfig({ ytCookies: "", ytCookiesB64: COOKIE_LINE });
  assert.ok(cfg.cookiesPath, "raw text should decode to a cookies file path");
  assert.ok(fs.existsSync(cfg.cookiesPath), "cookies file should exist");
  assert.ok(fs.readFileSync(cfg.cookiesPath, "utf8").startsWith("# Netscape"));
  clearEnv();
});

test("garbage YT_COOKIES_B64 never crashes boot (falls back to no cookies)", () => {
  clearEnv();
  const cfg = loadConfig({ ytCookies: "", ytCookiesB64: "%%%not-base64%%%" });
  assert.strictEqual(cfg.cookiesPath, "");
  clearEnv();
});