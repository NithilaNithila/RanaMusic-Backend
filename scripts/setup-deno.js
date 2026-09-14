#!/usr/bin/env node
// Installs a JavaScript runtime (deno) for yt-dlp so it can solve YouTube's
// signature + n challenges on servers where none is available (Render). Without
// a JS runtime yt-dlp gets every audio URL withheld ("Only images are available
// for download", formats = storyboards only). Runs as a postinstall so it fires
// during `npm ci` on any host. Skipped when a usable runtime already exists.
// Fail-soft: a download hiccup must never break the build.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const zlib = require("node:zlib");
const https = require("node:https");

const logs = (msg) => console.log(`[setup-deno] ${msg}`);
const warn = (msg) => console.warn(`[setup-deno] WARN: ${msg}`);

const projectDenoDir = path.join(__dirname, "..", ".deno", "bin");
const projectDeno = path.join(projectDenoDir, os.platform() === "win32" ? "deno.exe" : "deno");

const hasOnPath = (name) => {
  try {
    return (
      spawnSync(name, ["--version"], { stdio: "ignore" }).status !== null
    );
  } catch (_) {
    return false;
  }
};

const tryResolve = () => {
  if (process.env.DENO_INSTALL && fs.existsSync(process.env.DENO_INSTALL)) return true;
  return hasOnPath("deno");
};

// GitHub's /releases/latest/download/... URLs answer with a 302 redirect to a
// versioned asset URL. Node's https.get does NOT follow redirects, which made
// every install fail with "HTTP 302". Global fetch (Node >= 18) follows
// redirects automatically. Fall back to https.get only if fetch is missing.
const httpGetBuffer = async (url) => {
  if (typeof fetch === "function") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "setup-deno/1.0 (deno bootstrap)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 120000 }, (res) => {
        if (res.statusCode !== 200 && res.statusCode !== 302 && res.statusCode !== 307) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        if (res.statusCode === 302 || res.statusCode === 307) {
          res.resume();
          const loc = res.headers.location;
          if (!loc) return reject(new Error(`HTTP ${res.statusCode} without Location`));
          return httpGetBuffer(loc).then(resolve).catch(reject);
        }
        const bufs = [];
        res.on("data", (d) => bufs.push(d));
        res.on("end", () => resolve(Buffer.concat(bufs)));
      })
      .on("timeout", () => reject(new Error("download timeout")))
      .on("error", reject);
  });
};

// Entry name inside Deno's release zip is just `deno` (linux) or `deno.exe`.
const entryName = os.platform() === "win32" ? "deno.exe" : "deno";

// Extract the single `deno`/`deno.exe` file from a zip buffer (stored or
// deflated). Used as a fallback when the system `unzip` is missing.
function extractDenoEntry(buf, target) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sig = buf.readUInt32LE(0);
  if (sig !== 0x04034b50) throw new Error("not a zip");
  const method = view.getUint16(8, true);
  const compressed = buf.readUInt32LE(18);
  const uncompressed = buf.readUInt32LE(22);
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const name = buf.toString("utf8", 30, 30 + nameLen);
  if (name !== entryName) throw new Error(`unexpected entry: ${name}`);
  const data = buf.subarray(30 + nameLen + extraLen, 30 + nameLen + extraLen + compressed);
  const out =
    method === 8
      ? zlib.inflateRawSync(data, { maxOutputLength: uncompressed + 1 })
      : data;
  fs.writeFileSync(target, out);
}

const downloadDeno = async () => {
  if (fs.existsSync(projectDeno)) {
    logs("project-local deno already present, skipping");
    return true;
  }
  const arch =
    os.arch() === "x64" ? "x86_64" : os.arch() === "arm64" && os.platform() !== "win32" ? "aarch64" : os.arch();
  const plat = os.platform() === "darwin" ? "apple-darwin" : "unknown-linux-gnu";
  const url =
    os.platform() === "win32"
      ? "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip"
      : `https://github.com/denoland/deno/releases/latest/download/deno-${arch}-${plat}.zip`;
  logs(`downloading deno from ${url}`);
  const buf = await httpGetBuffer(url);
  fs.mkdirSync(projectDenoDir, { recursive: true });
  const unzip = spawnSync("unzip", ["-o", "-d", projectDenoDir, "-"], {
    input: buf,
    stdio: ["pipe", "ignore", "ignore"],
  });
  if (unzip.status === 0 && fs.existsSync(projectDeno)) {
    // ok
  } else {
    warn("system unzip failed; using internal extractor");
    extractDenoEntry(buf, projectDeno);
  }
  fs.chmodSync(projectDeno, 0o755);
  const out = execFileSync(projectDeno, ["--version"], { encoding: "utf8" });
  logs(`installed ${out.trim()}`);
  return true;
};

Promise.resolve()
  .then(() => {
    if (tryResolve()) return logs("usable JS runtime already on PATH, nothing to do");
    return downloadDeno();
  })
  .catch((err) => warn(`could not install deno (${err.message}); yt-dlp may miss formats`));