// In-process YouTube Music integration (yt-dlp based). No external proxy, no
// API key: yt-dlp resolves the audio stream and the backend pipes it directly.
// Defaults to enabled unless explicitly disabled.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { logger } = require("../services/logger.service");

// yt-dlp accepts Netscape-style cookie dumps: first line is the `# Netscape
// HTTP Cookie File` header, every following line is tab-separated fields.
// Anything else (JSON, encrypted exports, truncated base64) silently fails at
// streaming time, so sanity-check the decoded text at boot and warn early.
const looksLikeCookieFile = (text) =>
  /^#( Netscape)? HTTP Cookie File/i.test(String(text || "").trim().split(/\r?\n/)[0]);

// YouTube blocks anonymous playback from datacenter IPs ("Sign in to confirm
// you're not a bot"), so streaming needs a logged-in cookies.txt. Stateless
// hosts (Render free) have no place to drop a cookies file, so YT_COOKIES_B64
// accepts the exported cookies file base64-encoded in an env var and decodes
// it into a temp file once at boot -- no secret ever touches the repo. A real
// file path in YT_COOKIES wins (takes precedence) when one exists. Pasting the
// raw cookies.txt text is tolerated (multiline env values work in Render) so a
// missed encoding step is fixed automatically instead of failing at runtime.
const resolveCookiesPath = () => {
  const fromEnv = (process.env.YT_COOKIES || "").trim();
  if (fromEnv) return fromEnv;

  const trimmed = String(process.env.YT_COOKIES_B64 || "").trim();
  if (!trimmed) return "";
  try {
    const asBase64 = Buffer.from(trimmed, "base64").toString("utf8");
    const accepted = looksLikeCookieFile(asBase64)
      ? asBase64
      : looksLikeCookieFile(trimmed)
        ? trimmed
        : "";
    if (!accepted) {
      logger.warn(
        "YT_COOKIES_B64 did not decode to a Netscape cookie file - re-export cookies.txt and set its base64 (first line must be '# HTTP Cookie File')"
      );
      return "";
    }
    if (accepted !== asBase64) {
      logger.warn(
        "YT_COOKIES_B64 contained raw cookie text instead of base64 - accepted as-is"
      );
    }
    const file = path.join(os.tmpdir(), "ranamusic-yt-cookies.txt");
    fs.writeFileSync(file, accepted, { encoding: "utf8", mode: 0o600 });
    return file;
  } catch (_) {
    return "";
  }
};

// Cookies are the lynchpin: their presence switches streaming to the `tv`
// client below, so resolve them once and reuse for both settings.
const resolvedCookiesPath = resolveCookiesPath();

module.exports = {
  // Kill switch: YT_ENABLED=false disables every yt-dlp call; the resolver
  // falls back to Saavn-only and /stream responds 503.
  enabled: process.env.YT_ENABLED !== "false" ? true : false,

  // Optional override for the yt-dlp binary (absolute path). When empty the
  // packaged binary shipped by yt-dlp-exec (auto-downloaded on install) is used.
  binaryPath: process.env.YTDLP_BINARY || "",

  // yt-dlp setup flags (defaults chosen for reliability on datacenter IPs).
  cookiesPath: resolvedCookiesPath, // real file path (YT_COOKIES) or decoded YT_COOKIES_B64
  proxyUrl: process.env.YT_PROXY || "", // http(s) proxy for yt-dlp
  // Some residential gateways (e.g. proxyrise.com) listen on TLS but present a
  // private CA cert that public trust stores reject. When the proxy URL is an
  // https:// endpoint, relax yt-dlp's certificate check so the TLS-to-proxy
  // handshake can succeed.
  insecureProxy: /^https:\/\//i.test(process.env.YT_PROXY || ""),
  // Cookies present -> default to `web_embedded`. The web/mweb flow throws
  // "The page needs to be reloaded" (JS-reload challenge) on cautious
  // datacenter IPs, and `tv` does the same (verified locally). The embedded
  // player flow skips that challenge and still returns DRM-free m4a — verified
  // to resolve this video locally. Listing `default,web_embedded` doesn't help
  // because yt-dlp surfaces the first client's failure instead of falling
  // through, so it must be the single, first client. Without cookies, stay
  // unset (yt-dlp's default chain).
  playerClient:
    process.env.YT_PLAYER_CLIENT ||
    (resolvedCookiesPath ? "web_embedded" : ""), // locks youtube:player_client (used to dodge bot checks)
  // Format selector: prefer audio-only AAC, then any audio-only, then ANY
  // playable format. The embedded player served to cautious/datacenter IPs
  // sometimes omits audio-only entries entirely, so the trailing /best is the
  // escape hatch (combined video-only) that keeps the gap-fill playable.
  format: process.env.YT_FORMAT || "bestaudio[ext=m4a]/bestaudio/best",

  // Hard cap on simultaneously active yt-dlp *stream* processes. Stops a
  // burst of requests from spawning unbounded subprocesses (the /stream route
  // is public, so this doubles as the DoS guard alongside rate limiting).
  maxConcurrentStreams: Number(process.env.YT_MAX_CONCURRENCY || 5),

  // Timeouts/budgets (ms).
  infoTimeoutMs: Number(process.env.YT_INFO_TIMEOUT || 25000),
  streamStartTimeoutMs: Number(process.env.YT_STREAM_TIMEOUT || 15000),

  // Circuit breaker: after this many consecutive failures the breaker opens and
  // YT is skipped for cooldownMs so a throttled/bot-checked period can't stall
  // playback or resolution.
  breakerThreshold: Number(process.env.YT_BREAKER_THRESHOLD || 5),
  breakerCooldownMs: Number(process.env.YT_BREAKER_COOLDOWN || 60000),

  // YouTube Music InnerTube (youtubei) client used for catalog search
  // (albums/playlists/artists) and playlist/album detail pages. Albums and
  // playlists have no yt-dlp facet, so these come from the undocumented
  // youtubei JSON API instead of subprocess spawns. Details and catalog are
  // cheap (single POST); only audio streaming stays on yt-dlp.
  innertube: {
    // Public WEB_REMIX API key baked into the music.youtube.com web client.
    key: process.env.YTM_INNERTUBE_KEY || "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
    clientName: process.env.YTM_INNERTUBE_CLIENT || "WEB_REMIX",
    clientVersion: process.env.YTM_INNERTUBE_VERSION || "1.20240723.01.00",
    userAgent:
      process.env.YTM_INNERTUBE_UA ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    timeoutMs: Number(process.env.YTM_INNERTUBE_TIMEOUT || 15000),
  },
  // Exposed for tests; returns the resolved cookie file path ("" when none).
  __resolveCookiesPath: resolveCookiesPath,
  // Fixed temp path used for decoded YT_COOKIES_B64 content. Exposed so an
  // auth-gated admin route can refresh the cookies in-place (overwrite the temp
  // file) on an ephemeral host without a redeploy or env edit.
  cookieFilePath: path.join(os.tmpdir(), "ranamusic-yt-cookies.txt"),
};