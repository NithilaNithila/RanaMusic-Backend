// In-process YouTube Music integration backed by yt-dlp. Resolves an audio
// stream for a YouTube Music videoId and (optionally) a single-track search
// used by the resolver when Saavn has no strong match. No API key, no proxy:
// the backend itself is the streaming hop.
const ytdl = require("yt-dlp-exec");
const axios = require("axios");
const ytConfig = require("../config/ytmusic");
const { httpAgent, httpsAgent } = require("../config/http");
const { retry } = require("../utils/retry");
const { memoize, makeCacheKey } = require("./cache.service");
const { logger } = require("./logger.service");
const { normalizeSearchTrack } = require("./ytmusic.mappers");

// Exact require path of the binaries shipped by yt-dlp-exec / fallback binary.
const resolvedBinary = ytConfig.binaryPath
  ? ytdl.create(ytConfig.binaryPath)
  : ytdl;

const SPAWN_OPTS = { stdio: ["ignore", "pipe", "pipe"], windowsHide: true };

const JSON_RETRIES = 1;
const JSON_INFO_TTL = 600; // seconds - per-video info is stable
const SEARCH_TTL = 600;

class YtStreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "YtStreamError";
    this.status = status;
  }
}

const isEnabled = () => ytConfig.enabled;

// Warn once at boot when the free cookies-first setup is incomplete: without
// a logged-in cookies.txt, datacenter IPs (Render free) get "Sign in to
// confirm you're not a bot" 403s and the circuit breaker opens.
if (ytConfig.enabled && !ytConfig.cookiesPath) {
  logger.warn(
    "YouTube Music is enabled but no cookies are configured (set YT_COOKIES or YT_COOKIES_B64) — datacenter IPs will hit bot checks"
  );
}

// Bot-check (403) tracking for the /api/ytmusic/status health signal. A rising
// count with recent lastBotCheckAt means cookies expired or the IP got flagged
// — time to refresh YT_COOKIES_B64, not to change code.
let botCheckCount = 0;
let lastBotCheckAt = null;

const recordBotCheck = () => {
  botCheckCount += 1;
  lastBotCheckAt = new Date().toISOString();
};

const disabledError = () =>
  new YtStreamError("YouTube Music is disabled (YT_ENABLED=false)", 503);

// ── circuit breaker ───────────────────────────────────────────────────
// Consecutive throttling/unreachable failures open the breaker so the live
// app skips YouTube while a datacenter IP is being bot-checked or rate
// limited. Recovers automatically after the cooldown; success resets it.
let consecutiveFailures = 0;
let openUntil = 0;

const breakerWorthyStatus = (status) =>
  status === 403 || status === 429 || status === 502 || status === 503;

const isBreakerOpen = () => Date.now() < openUntil;

const recordFailure = (err) => {
  if (!breakerWorthyStatus(err && err.status)) return;
  // A 403 is the "sign in to confirm you're not a bot" wall (or an innertube
  // header requirement) — count it once per failed call so /api/ytmusic/status
  // shows cookie expiry as a rising botCheckCount.
  if (err && err.status === 403) recordBotCheck();
  // A missing/misconfigured binary won't recover from a cooldown — don't let
  // it open the breaker (the resolver should stay out of YouTube only on real
  // upstream throttling).
  if (err && err.binaryMissing) return;
  consecutiveFailures += 1;
  if (consecutiveFailures >= ytConfig.breakerThreshold) {
    openUntil = Date.now() + ytConfig.breakerCooldownMs;
    logger.warn(
      { threshold: consecutiveFailures, cooldownMs: ytConfig.breakerCooldownMs },
      "ytmusic circuit breaker opened"
    );
  }
};

const recordSuccess = () => {
  consecutiveFailures = 0;
};

const beforeCall = () => {
  if (isBreakerOpen()) {
    throw new YtStreamError("Source temporarily unavailable", 503);
  }
};

// ── error mapping ─────────────────────────────────────────────────────
const mapError = (err) => {
  if (err instanceof YtStreamError) return err;
  const stderr = String((err && err.stderr) || "");
  const message = String((err && err.message) || "");

  if (err && err.code === "ENOENT") {
    const e = new YtStreamError("yt-dlp binary not found; set YTDLP_BINARY", 502);
    e.binaryMissing = true;
    return e;
  }

  if (/sign in to confirm|not a bot|recaptcha|captcha|verify that you are a human/i.test(stderr)) {
    return new YtStreamError("YouTube is requesting a bot check (IP may be throttled)", 403);
  }
  if (/HTTP Error 429|HTTP error 429/i.test(stderr)) {
    return new YtStreamError("YouTube rate limited", 429);
  }
  if (
    /video unavailable|private video|members only|this video is not available|has been removed|does not exist|sign in to watch|premium/i.test(
      stderr
    ) ||
    /video unavailable|private video|members only/i.test(message)
  ) {
    return new YtStreamError("Video is not available", 404);
  }
  if (
    /unsupported url|invalid url|could not extract|cannot download|no video formats|is not a valid/i.test(
      stderr
    )
  ) {
    return new YtStreamError("Could not extract audio", 404);
  }
  if (
    /timed out|timeout|temporary failure|connection reset|connection refused/i.test(stderr) ||
    err.code === "ETIMEDOUT" ||
    err.code === "ECONNRESET" ||
    err.code === "ECONNREFUSED"
  ) {
    return new YtStreamError("YouTube unreachable", 502);
  }
  return new YtStreamError(
    snippetOf(stderr) ? `yt-dlp failed: ${snippetOf(stderr)}` : "yt-dlp failed",
    502
  );
};

// Only genuinely ephemeral failures are worth one retry; a resolved 404/403
// (bot check) won't fix itself in a few hundred ms.
const isTransient = (err) => err.status === 502 || err.status === 504 || err.status === 0 || err.status === undefined;

// Last few meaningful lines of yt-dlp stderr, appended to unmapped failures so
// the specific cause (invalid cookie file, bad binary, network quirk) surfaces
// in the API instead of a bare "exit code 1".
const snippetOf = (stderr) =>
  String(stderr || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-3)
    .join(" | ")
    .slice(0, 400);

// ──────────────────── innertube (youtubei) catalog client ────────────────────
// Albums, playlists and artists have no yt-dlp search facet, so catalog search
// and collection detail are served from YouTube Music's own (undocumented)
// youtubei JSON API. It mirrors the music.youtube.com web client: one shared
// keep-alive axios client POSTs to /youtubei/v1/{search,browse} with the
// WEB_REMIX context. Names/ids/thumbnails come from musicResponsiveListItem
// rows; nothing here touches yt-dlp, so the flow never spawns a child.
const YTM_ORIGIN = "https://music.youtube.com";
const YTM_INNERTUBE_SERVER = "https://music.youtube.com/youtubei/v1/";

const ytmClient = axios.create({
  httpAgent,
  httpsAgent,
  timeout: ytConfig.innertube.timeoutMs,
  headers: {
    "content-type": "application/json",
    "user-agent": ytConfig.innertube.userAgent,
    accept: "*/*",
  },
});

const mapHttpError = (err) => {
  if (err instanceof YtStreamError) return err;
  const status =
    (err && err.response && err.response.status) ||
    (err && (err.code === "ETIMEDOUT" || err.code === "ECONNRESET" || err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" || err.code === "EHOSTUNREACH"))
      ? 502
      : 502;
  const response = err && err.response && err.response.data;
  const bodyMsg =
    response && typeof response === "object" && response.error && response.error.message
      ? response.error.message
      : response && response.message;
  const message = String(bodyMsg || (err && err.message) || "YouTube Music API error").slice(0, 500);
  return new YtStreamError(message, status);
};

// POSTs a youtubei request. Shares the yt-dlp circuit breaker + retry budget
// so a bot-checked/rate-limited period degrades the whole provider at once.
const ytmPost = async (endpoint, body) => {
  if (!isEnabled()) throw disabledError();
  beforeCall();
  const payload = {
    context: {
      client: {
        clientName: ytConfig.innertube.clientName,
        clientVersion: ytConfig.innertube.clientVersion,
      },
    },
    ...body,
  };
  try {
    const { data } = await retry(
      () =>
        ytmClient.post(`${YTM_INNERTUBE_SERVER}${endpoint}`, payload, {
          params: { key: ytConfig.innertube.key, prettyPrint: false },
        }),
      {
        retries: 1,
        baseMs: 500,
        shouldRetry: (err) => isTransient(mapHttpError(err)),
      }
    );
    recordSuccess();
    return data;
  } catch (err) {
    const mapped = mapHttpError(err);
    recordFailure(mapped);
    throw mapped;
  }
};

// ──────────────── innertube search-row mapping helpers ────────────────
const searchTabContents = (data) =>
  data &&
  data.contents &&
  data.contents.tabbedSearchResultsRenderer &&
  data.contents.tabbedSearchResultsRenderer.tabs &&
  data.contents.tabbedSearchResultsRenderer.tabs[0] &&
  data.contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer &&
  data.contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content &&
  data.contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer &&
  data.contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents;

// Collects every musicResponsiveListItem *renderer* under a node in document
// order (deduped by reference so a renderer shared by fields isn't doubled).
// Helpers below read flexColumns/thumbnail/etc. directly off the renderer, so
// the { musicResponsiveListItemRenderer } wrapper is unwrapped here.
const collectRows = (node, out = [], seen = new Set()) => {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) collectRows(n, out, seen);
    return out;
  }
  if (node.musicResponsiveListItemRenderer) {
    const renderer = node.musicResponsiveListItemRenderer;
    if (renderer && !seen.has(renderer)) {
      seen.add(renderer);
      out.push(renderer);
    }
  }
  for (const k of Object.keys(node)) collectRows(node[k], out, seen);
  return out;
};

const flexText = (row, i) =>
  ((row.flexColumns || [])[i] &&
    (row.flexColumns[i].musicResponsiveListItemFlexColumnRenderer || {}).text &&
    ((row.flexColumns[i].musicResponsiveListItemFlexColumnRenderer.text || {}).runs || []).map((r) => r.text || "").join("").trim()) ||
  "";

// Second column is a "•"-joined tag line, e.g. "Album • Ilaiyaraaja • 2025",
// "Playlist • YouTube Music • 104 songs", "Song • Artist".
const segs = (row, i) => flexText(row, i).split("•").map((s) => s.trim());

const rowKind = (row) => String(segs(row, 1)[0] || "").toLowerCase();

const imageOf = (row) => {
  const t = row.thumbnail && row.thumbnail.musicThumbnailRenderer && row.thumbnail.musicThumbnailRenderer.thumbnail && row.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails;
  return Array.isArray(t) && t.length ? t[t.length - 1].url || "" : "";
};

const durationToSeconds = (text) => {
  const m = String(text || "").match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return m[1] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[2]) * 60 + Number(m[3]);
};

const rowDuration = (row) => {
  const runs =
    (row.fixedColumns || [])[0] &&
    ((row.fixedColumns[0].musicResponsiveListItemFixedColumnRenderer || {}).text || {}).runs ||
    [];
  return durationToSeconds(runs.map((r) => r.text || "").join(""));
};

const browseIdOf = (row) => {
  const nav = row.navigationEndpoint || (row.flexColumns && row.flexColumns[0] && row.flexColumns[0].musicResponsiveListItemFlexColumnRenderer && row.flexColumns[0].musicResponsiveListItemFlexColumnRenderer.navigationEndpoint);
  return (nav && nav.browseEndpoint && nav.browseEndpoint.browseId) || "";
};

const videoIdOf = (row) =>
  row.videoId ||
  (row.playlistItemData && row.playlistItemData.videoId) ||
  (row.navigationEndpoint && row.navigationEndpoint.watchEndpoint && row.navigationEndpoint.watchEndpoint.videoId) ||
  (row.navigationEndpoint && row.navigationEndpoint.playNavigationEndpoint && row.navigationEndpoint.playNavigationEndpoint.watchEndpoint && row.navigationEndpoint.playNavigationEndpoint.watchEndpoint.videoId) ||
  "";

const normalizeAlbumRow = (row) => {
  const s = segs(row, 1);
  const browseId = browseIdOf(row);
  return {
    id: browseId,
    name: flexText(row, 0),
    type: "album",
    artist_name: s[1] || "",
    image: imageOf(row),
    year: s[2] || flexText(row, 2) || "",
    song_count: 0,
    language: "",
    url: browseId ? `${YTM_ORIGIN}/browse/${browseId}` : "",
    play_count: "",
    songs: [],
  };
};

const normalizePlaylistRow = (row) => {
  const s = segs(row, 1);
  const browseId = browseIdOf(row);
  const bareId = String(browseId).replace(/^VL/, "");
  const trackCount = parseInt(String(s[2] || "").replace(/[^0-9]/g, ""), 10) || 0;
  return {
    id: bareId,
    name: flexText(row, 0),
    type: "playlist",
    image: imageOf(row),
    language: "",
    url: bareId ? `${YTM_ORIGIN}/playlist?list=${bareId}` : "",
    track_count: trackCount,
    songs: [],
  };
};

const normalizeArtistRow = (row) => {
  const browseId = browseIdOf(row);
  const name = flexText(row, 0);
  return {
    id: browseId,
    name,
    type: "artist",
    image: imageOf(row),
    url: browseId ? `${YTM_ORIGIN}/channel/${browseId}` : "",
    song_count: 0,
    verified: /verified/i.test(String(segs(row, 1)[1] || "")),
  };
};

// Album, artist and playlist facets, served by the youtubei search endpoint.
const CATALOG_KINDS = {
  album: new Set(["album", "single"]),
  artist: new Set(["artist"]),
  playlist: new Set(["playlist"]),
};

const CATALOG_NORMALIZERS = {
  album: normalizeAlbumRow,
  artist: normalizeArtistRow,
  playlist: normalizePlaylistRow,
};

// Albums/playlists search for the unified search page. These facets don't
// exist in yt-dlp's ytsearch, so the youtubei search endpoint is used and only
// rows whose tag line matches the requested kind are kept. Cached per
// query/type/slide so pagination taps reuse one upstream POST.
const searchCatalog = (query, type, limit, offset) =>
  memoize(makeCacheKey("yt:innertube-search", { q: String(query || "").trim(), type, limit, offset }), SEARCH_TTL, async () => {
    const data = await ytmPost("search", { query: String(query || "").trim() });
    const rows = collectRows(searchTabContents(data));
    const kind = CATALOG_KINDS[type];
    const normalize = CATALOG_NORMALIZERS[type];
    if (!kind || !normalize) return [];
    const out = [];
    for (const row of rows) {
      if (!kind.has(rowKind(row))) continue;
      const item = normalize(row);
      if (!item || !item.id) continue;
      out.push(item);
      if (out.length >= offset + limit) break;
    }
    return out.slice(offset, offset + limit);
  });

// ──────────────────── collection detail (browse) ────────────────────
// Resolves the header + tracklist of a playlist ("VL...") or album ("MPREb_...")
// via the youtubei browse endpoint. The first musicResponsiveHeaderRenderer
// gives the title/artwork; the first track shelf (musicPlaylistShelfRenderer
// for playlists, musicShelfRenderer for albums) gives the songs.
const findBrowseNodes = (data) => {
  let header = null;
  let shelf = null;
  const visit = (node, depth) => {
    if (!node || depth > 20 || (header && shelf)) return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    if (!header && node.musicResponsiveHeaderRenderer) header = node.musicResponsiveHeaderRenderer;
    if (!shelf) {
      if (node.musicPlaylistShelfRenderer) shelf = node.musicPlaylistShelfRenderer;
      else if (node.musicShelfRenderer) shelf = node.musicShelfRenderer;
    }
    for (const k of Object.keys(node)) visit(node[k], depth + 1);
  };
  visit(data, 0);
  return { header, shelf };
};

const headerInfo = (h) => {
  const title = ((h.title && h.title.runs) || []).map((r) => r.text || "").join("").trim();
  const subtitle = ((h.subtitle && h.subtitle.runs) || []).map((r) => r.text || "").join("").trim();
  const t = h.thumbnail && h.thumbnail.musicThumbnailRenderer && h.thumbnail.musicThumbnailRenderer.thumbnail && h.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails;
  const image = Array.isArray(t) && t.length ? t[t.length - 1].url || "" : "";
  const tagSegs = subtitle.split("•").map((s) => s.trim());
  return { title, subtitle, image, kind: String(tagSegs[0] || "").toLowerCase(), year: tagSegs[1] || "" };
};

// Playlist ids arrive from search without the "VL" prefix (it's stripped by
// normalizePlaylistRow). Detail lookups and the browse call need it back, but
// a full id that already starts with "VL" must not be prefixed twice.
const playlistBrowseId = (id) => (String(id).startsWith("VL") ? String(id) : `VL${id}`);

const mapDetailTrack = (row) => {
  const videoId = videoIdOf(row);
  return {
    id: videoId,
    name: flexText(row, 0),
    type: "track",
    source: "ytmusic",
    artist_name: flexText(row, 1),
    album_name: "",
    album_id: "",
    image: imageOf(row),
    audio: videoId ? `/api/ytmusic/songs/${videoId}/stream` : "",
    duration: rowDuration(row),
    year: "",
    play_count: "",
    language: "",
    url: videoId ? `${YTM_ORIGIN}/watch?v=${videoId}` : "",
    has_lyrics: false,
  };
};

// Full playlist/album detail (header + songs). Cached per browseId (10 min),
// same TTL as per-video info: catalog metadata is stable between edits.
const getCollectionDetail = (browseId) =>
  memoize(makeCacheKey("yt:collection-detail", { browseId: String(browseId) }), JSON_INFO_TTL, async () => {
    const data = await ytmPost("browse", { browseId: String(browseId) });
    const { header, shelf } = findBrowseNodes(data);
    const info = header ? headerInfo(header) : { title: "", image: "", kind: "", year: "" };
    const rows = collectRows(shelf && shelf.contents);
    const isAlbum = info.kind === "album" || info.kind === "single";
    const bareId = String(browseId).replace(/^VL/, "");
    return {
      id: bareId,
      name: info.title,
      type: isAlbum ? "album" : "playlist",
      image: info.image,
      artist_name: "",
      year: info.year,
      language: "",
      url: isAlbum ? `${YTM_ORIGIN}/browse/${browseId}` : `${YTM_ORIGIN}/playlist?list=${bareId}`,
      track_count: isAlbum ? 0 : rows.length,
      song_count: isAlbum ? rows.length : 0,
      songs: rows.map(mapDetailTrack).filter((t) => t.id),
    };
  });

const getCollectionTracks = (browseId) => getCollectionDetail(browseId).then((detail) => detail.songs);

// ── flags ─────────────────────────────────────────────────────────────
const buildFlags = (extra = {}) => {
  const flags = {
    format: ytConfig.format,
    noPlaylist: true,
    quiet: true,
    noWarnings: true,
    socketTimeout: 15,
    retries: 1,
    ...extra,
  };
  if (ytConfig.playerClient) flags.extractorArgs = `youtube:player_client=${ytConfig.playerClient}`;
  if (ytConfig.cookiesPath) flags.cookies = ytConfig.cookiesPath;
  if (ytConfig.proxyUrl) {
    flags.proxy = ytConfig.proxyUrl;
    if (ytConfig.insecureProxy) flags.noCheckCertificate = true;
  }
  return flags;
};

const watchUrl = (videoId) => `https://music.youtube.com/watch?v=${videoId}`;

// Waits for a spawned child to finish, collecting its stdout/stderr. Rejects
// with the exit code / spawn error so callers can inspect stderr.
const collect = (child) =>
  new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(Object.assign(err, { stderr }));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve({ stdout, stderr });
      else {
        const err = new Error(`yt-dlp exited with code ${code}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });

// Runs a yt-dlp JSON query (-J) with retry + breaker protection.
const runJson = async (url, extraFlags = {}) => {
  if (!isEnabled()) throw disabledError();
  beforeCall();

  const fetch = () => {
    const child = resolvedBinary.exec(
      url,
      buildFlags({ ...extraFlags, dumpSingleJson: true }),
      { ...SPAWN_OPTS, timeout: ytConfig.infoTimeoutMs, killSignal: "SIGKILL" }
    );
    return collect(child);
  };

  try {
    const { stdout } = await retry(
      () =>
        fetch().then((out) => {
          recordSuccess();
          return out;
        }),
      {
        retries: JSON_RETRIES,
        baseMs: 600,
        shouldRetry: (err) => isTransient(mapError(err)),
      }
    );
    return JSON.parse(stdout);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new YtStreamError("yt-dlp returned unparsable output", 502);
    }
    const mapped = mapError(err);
    recordFailure(mapped);
    throw mapped;
  }
};

const contentTypeFor = (info) => {
  if (info.mime_type) return String(info.mime_type).split(";")[0].trim();
  const ext = String(info.ext || "").toLowerCase();
  if (["m4a", "m4p", "m4b", "mp4"].includes(ext)) return "audio/mp4";
  if (["webm", "opus", "ogg"].includes(ext)) return "audio/webm";
  if (ext) return `audio/${ext}`;
  return "application/octet-stream";
};

// Resolves a video's playable shape: format / content type / duration /
// artwork. Cached so repeat plays of the same track skip the info spawn and
// go straight to streaming.
const getTrackInfo = (videoId) =>
  memoize(makeCacheKey("yt:info", { id: videoId }), JSON_INFO_TTL, async () => {
    const data = await runJson(watchUrl(videoId));
    if (!data || !data.id) throw new YtStreamError("No data for video", 404);
    return {
      id: data.id,
      title: data.title || "",
      duration: data.duration || 0,
      ext: (data.ext || "").toLowerCase(),
      contentType: contentTypeFor(data),
      thumbnail: data.thumbnail || "",
    };
  });

// Single-result YouTube Music search used by the resolver for the ~small
// share of tracks Saavn can't match. Cached per query.
const searchTrack = (query) =>
  memoize(makeCacheKey("yt:search", { q: String(query || "").trim() }), SEARCH_TTL, async () => {
    const data = await runJson(`ytsearch1:${query}`, {
      dumpSingleJson: true,
      skipDownload: true,
    });
    const hit =
      data && Array.isArray(data.entries) && data.entries.length ? data.entries[0] : null;
    if (!hit || !hit.id) return null;
    return {
      videoId: hit.id,
      name: hit.title || "",
      duration: Number(hit.duration) || 0,
      thumbnail: hit.thumbnail || "",
    };
  });

const SEARCH_TYPES = ["track", "album", "artist", "playlist"];

const clampLimit = (limit) => Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
const clampOffset = (offset) => Math.max(parseInt(offset, 10) || 0, 0);

const resolveSearchTypes = (type) => {
  if (!type || type === "all") return SEARCH_TYPES;
  const requested = String(type)
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => SEARCH_TYPES.includes(t));
  return requested.length ? requested : SEARCH_TYPES;
};

// Multi-result YouTube Music search feeding the unified 4-provider search
// page. Only the "track" type spawns yt-dlp (`ytsearch{n}:query` returns plain
// video entries); albums/artists/playlists have no yt-dlp facet, so those come
// from the youtubei innertube catalog search instead of spawning a child.
const search = async (query, opts = {}) => {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  const types = resolveSearchTypes(opts.type);

  const results = {};
  let total = 0;

  await Promise.allSettled(
    types.map(async (type) => {
      if (type !== "track") {
        results[type] = await searchCatalog(query, type, limit, offset);
        total += results[type].length;
        return;
      }
      const q = String(query || "").trim();
      const searchUrl = `ytsearch${limit}:${q}`;
      // Search entries don't need per-video format extraction (audio is
      // served via /api/ytmusic/songs/:id/stream later) — flat-playlist keeps
      // the dump cheap (~3s even for ytsearch10) instead of spending >100s
      // resolving formats for every hit. Flat entries still carry title /
      // duration / uploader / thumbnails, which is all the mapper needs.
      // Also: do NOT pass noPlaylist:false — yt-dlp-exec renders that as the
      // invalid `--no-no-playlist` and the whole search fails.
      const data = await memoize(
        makeCacheKey("yt:search:list", { q, limit }),
        SEARCH_TTL,
        () =>
          runJson(searchUrl, {
            dumpSingleJson: true,
            skipDownload: true,
            flatPlaylist: true,
          })
      );
      const entries = (data && Array.isArray(data.entries) ? data.entries : []).slice(
        offset,
        offset + limit
      );
      results[type] = entries.map(normalizeSearchTrack).filter(Boolean);
      total += results[type].length;
    })
  );

  for (const type of types) {
    if (!results[type]) results[type] = [];
  }

  return { total, results };
};

// Spawns the actual audio download. The returned child's stdout is the raw
// audio bytes (bestaudio); the caller pipes it to the response and owns the
// lifecycle (kill on client abort, drain stderr).
//
// A counting gate caps concurrent live stream processes so a burst of requests
// can't spawn unbounded yt-dlp children (the /stream route is public). When
// the cap is hit the call is rejected fast instead of queueing up.
let activeStreams = 0;
// Live spawned stream children, tracked so shutdown can reap any that a client
// abandoned without waiting for the process to drain.
const liveChildren = new Set();
const spawnStream = (videoId) => {
  if (!isEnabled()) throw disabledError();
  beforeCall();
  if (activeStreams >= ytConfig.maxConcurrentStreams) {
    throw new YtStreamError("Too many concurrent streams, try again shortly", 429);
  }
  const child = resolvedBinary.exec(
    watchUrl(videoId),
    buildFlags({ output: "-", format: ytConfig.format }),
    SPAWN_OPTS
  );
  activeStreams += 1;
  liveChildren.add(child);
  child.on("close", () => {
    activeStreams = Math.max(0, activeStreams - 1);
    liveChildren.delete(child);
  });
  // Drain stderr so yt-dlp progress/errors can't stall the child on a full
  // pipe buffer while bytes are flowing to the client.
  child.stderr.on("data", () => {});
  return child;
};

// Cached yt-dlp binary version, exposed via /api/ytmusic/status so a stale
// binary on a hosted build (Render build cache restores old node_modules and
// skips yt-dlp-exec's fresh-binary postinstall) is visible without SSH.
let ytDlpVersionPromise = null;
const getYtDlpVersion = () => {
  if (!ytDlpVersionPromise) {
    ytDlpVersionPromise = resolvedBinary
      .exec("--version", {}, { timeout: 10000 })
      .then((out) => String((out && out.stdout) || out || "").trim())
      .catch(() => "");
  }
  return ytDlpVersionPromise;
};

// SIGKILL every still-live stream child. Called during shutdown so a deploy /
// restart can't leave orphaned youtube-dl processes downloading in the void.
const killAllStreams = () => {
  for (const child of liveChildren) {
    try {
      child.kill("SIGKILL");
    } catch (_) {
      // process already gone
    }
  }
  liveChildren.clear();
};

// Operational snapshot for /api/ytmusic/status. The health signal for the free
// cookies-first setup: when botCheckCount grows and lastBotCheckAt is recent,
// refresh YT_COOKIES_B64 (or add YT_COOKIES) rather than touching code.
const getStatus = () => ({
  enabled: isEnabled(),
  breakerOpen: isBreakerOpen(),
  botCheckCount,
  lastBotCheckAt,
  cookiesConfigured: Boolean(ytConfig.cookiesPath),
  playerClient: ytConfig.playerClient || "",
  proxyConfigured: Boolean(ytConfig.proxyUrl),
  binaryVersion: null,
  activeStreams,
  maxConcurrentStreams: ytConfig.maxConcurrentStreams,
});

module.exports = {
  YtStreamError,
  isEnabled,
  isBreakerOpen,
  search,
  searchCatalog,
  searchTrack,
  getTrackInfo,
  getCollectionDetail,
  getCollectionTracks,
  playlistBrowseId,
  spawnStream,
  mapError,
  getStatus,
  getYtDlpVersion,
  killAllStreams,
};