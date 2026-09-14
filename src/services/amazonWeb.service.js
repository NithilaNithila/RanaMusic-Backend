// Unofficial Amazon Music web-player scraper.
//
// Mirrors the approach of https://github.com/MarkWasley/Amazon-Music-API
// (fork of notdeltaxd/Amazon-Music-API): fetch the PUBLIC music.amazon.com
// config.json (deviceId/sessionId/csrf), then POST to Amazon's internal
// skill endpoints. The whole skill "identity" rides inside the POST body's
// `headers` string, not in real HTTP headers. No login cookies required for
// catalog search + metadata; results are normalized to the same unified
// shapes as amazon.mappers.js so the frontend treats this like any provider.
//
// DRM note: Amazon only serves its streams to Widevine-protected players, so
// the skill API exposes catalog + metadata only (no audio URL in any
// response). Playable audio is added by the shared Saavn resolver
// (see amazonWeb.controller + search.service's makePlayable) so every row is
// streamable; the normalizer contract keeps `audio` empty here.
const axios = require("axios");
const amazonWebConfig = require("../config/amazonWeb");
const { httpAgent, httpsAgent } = require("../config/http");
const {
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
} = require("./amazon.mappers");
const { resolvePlayableAudio } = require("./trackResolver.service");
const mapLimit = require("../utils/mapLimit");
const { retry } = require("../utils/retry");

const client = axios.create({ httpAgent, httpsAgent });

class AmazonWebError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "AmazonWebError";
    this.status = status;
  }
}

const isNotFound = (err) =>
  err instanceof AmazonWebError && (err.status === 404 || err.status === 400);

// ── constants ─────────────────────────────────────────────────────────┐

const SINGLE_REGION_HOST = "https://eu.mesk.skill.music.a2z.com";

const ENDPOINTS = {
  config: "https://music.amazon.com/config.json",
  searchTracks: `${SINGLE_REGION_HOST}/api/searchCatalogTracks`,
  searchAlbums: `${SINGLE_REGION_HOST}/api/searchCatalogAlbums`,
  searchArtists: `${SINGLE_REGION_HOST}/api/searchCatalogArtists`,
  searchPlaylists: `${SINGLE_REGION_HOST}/api/searchCatalogPlaylists`,
  searchCommunityPlaylists: `${SINGLE_REGION_HOST}/api/searchCommunityPlaylists`,
  track: `${SINGLE_REGION_HOST}/api/cosmicTrack/displayCatalogTrack`,
  album: `${SINGLE_REGION_HOST}/api/showCatalogAlbum`,
  artist: `${SINGLE_REGION_HOST}/api/explore/v1/showCatalogArtist`,
  playlist: `${SINGLE_REGION_HOST}/api/showCatalogPlaylist`,
  communityPlaylist: `${SINGLE_REGION_HOST}/api/showLibraryPlaylist`,
};

const WEB_SKILL_HOSTS = {
  na: "https://na.web.skill.music.a2z.com",
  eu: "https://eu.web.skill.music.a2z.com",
  fe: "https://fe.web.skill.music.a2z.com",
};

const HD_FLAGS = "hd-supported,uhd-supported";

// music.amazon.{domain} → regional skill group + locale overrides.
const REGION_CONFIG_MAP = {
  "music.amazon.com": { skill: "na", language: "en_US", currency: "USD", featureFlags: "" },
  "music.amazon.com.mx": { skill: "na", language: "es_MX", currency: "MXN", featureFlags: "" },
  "music.amazon.com.br": { skill: "na", language: "pt_BR", currency: "BRL", featureFlags: "" },
  "music.amazon.ca": { skill: "na", language: "en_CA", currency: "CAD", featureFlags: "" },
  "music.amazon.co.uk": { skill: "eu", language: "en_GB", currency: "GBP", featureFlags: HD_FLAGS },
  "music.amazon.de": { skill: "eu", language: "de_DE", currency: "EUR", featureFlags: HD_FLAGS },
  "music.amazon.fr": { skill: "eu", language: "fr_FR", currency: "EUR", featureFlags: HD_FLAGS },
  "music.amazon.it": { skill: "eu", language: "it_IT", currency: "EUR", featureFlags: HD_FLAGS },
  "music.amazon.es": { skill: "eu", language: "es_ES", currency: "EUR", featureFlags: HD_FLAGS },
  "music.amazon.in": { skill: "eu", language: "en_IN", currency: "INR", featureFlags: HD_FLAGS },
  "music.amazon.sa": { skill: "eu", language: "ar_SA", currency: "SAR", featureFlags: "" },
  "music.amazon.ae": { skill: "eu", language: "ar_AE", currency: "AED", featureFlags: "" },
  "music.amazon.co.jp": { skill: "fe", language: "ja_JP", currency: "JPY", featureFlags: HD_FLAGS },
  "music.amazon.com.au": { skill: "fe", language: "en_AU", currency: "AUD", featureFlags: HD_FLAGS },
};

const USER_HASH = JSON.stringify({ level: "LIBRARY_MEMBER" });

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
];

const randomUA = () =>
  USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const clampPage = (page) => Math.min(Math.max(parseInt(page, 10) || 1, 1), 25);
const clampLimit = (limit, max) =>
  Math.min(Math.max(parseInt(limit, 10) || max, 1), max);

// ── HTTP plumbing ────────────────────────────────────────────────────┐

// Real HTTP headers sent on every skill POST + single-region config GET.
const defaultHeaders = () => ({
  authority: "eu.mesk.skill.music.a2z.com",
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9",
  "content-type": "text/plain;charset=UTF-8",
  origin: "https://music.amazon.com",
  priority: "u=1, i",
  referer: "https://music.amazon.com/",
  "sec-ch-ua": '"Chromium";v="125", "Not.A/Brand";v="24"',
  "sec-ch-ua-mobile": "?1",
  "sec-ch-ua-platform": '"Android"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "cross-site",
  "user-agent": randomUA(),
});

// Per-domain config.json GET uses a same-origin browser-ish header set.
const domainConfigHeaders = (domain) => {
  const base = defaultHeaders();
  delete base.authority;
  delete base["content-type"];
  base.referer = `https://${domain}/`;
  base["sec-fetch-site"] = "same-origin";
  return base;
};

const CONFIG_TTL = { single: 30_000, domain: 300_000 };
const configCache = new Map(); // domain("" = single) -> { ts, cfg }

async function fetchConfig(domain = "") {
  const ttl = domain ? CONFIG_TTL.domain : CONFIG_TTL.single;
  const now = Date.now();
  const hit = configCache.get(domain);
  if (hit && now - hit.ts < ttl) return hit.cfg;

  const url = domain ? `https://${domain}/config.json` : ENDPOINTS.config;
  const headers = domain ? domainConfigHeaders(domain) : defaultHeaders();
  const res = await client.get(url, {
    headers,
    timeout: amazonWebConfig.timeouts.config,
  });
  const cfg = res.data || {};
  configCache.set(domain, { ts: now, cfg });
  return cfg;
}

// Builds the skill "identity" object that gets JSON.stringify'd into the
// POST body's `headers` field. `overrides` swap locale/domain per region.
const buildAmazonHeaders = (cfg, pageUrl, overrides = {}) => {
  const csrf = cfg.csrf || {};
  const base = {
    "x-amzn-authentication": JSON.stringify({
      interface: "ClientAuthenticationInterface.v1_0.ClientTokenElement",
      accessToken: cfg.accessToken || "",
    }),
    "x-amzn-device-model": "WEBPLAYER",
    "x-amzn-device-width": "1920",
    "x-amzn-device-family": "WebPlayer",
    "x-amzn-device-id": cfg.deviceId || "",
    "x-amzn-user-agent": randomUA(),
    "x-amzn-session-id": cfg.sessionId || "",
    "x-amzn-device-height": "1080",
    "x-amzn-request-id": Math.random().toString(36).substring(2, 15),
    "x-amzn-device-language": "en_US",
    "x-amzn-currency-of-preference": "USD",
    "x-amzn-os-version": "1.0",
    "x-amzn-application-version": cfg.version || "",
    "x-amzn-device-time-zone": "Asia/Calcutta",
    "x-amzn-timestamp": String(Date.now()),
    "x-amzn-csrf": JSON.stringify({
      interface: "CSRFInterface.v1_0.CSRFHeaderElement",
      token: csrf.token || "",
      timestamp: String(csrf.ts || ""),
      rndNonce: String(csrf.rnd || ""),
    }),
    "x-amzn-music-domain": "music.amazon.com",
    "x-amzn-referer": "music.amazon.com",
    "x-amzn-affiliate-tags": "",
    "x-amzn-ref-marker": "",
    "x-amzn-page-url": pageUrl || "",
    "x-amzn-weblab-id-overrides": "",
    "x-amzn-video-player-token": "",
    "x-amzn-feature-flags": HD_FLAGS,
    "x-amzn-has-profile-id": "",
    "x-amzn-age-band": "",
  };
  return { ...base, ...overrides };
};

const postSkill = async (url, cfg, body, pageUrl, { region, domain, timeout } = {}) => {
  const overrides = region
    ? {
        "x-amzn-device-language": region.language,
        "x-amzn-currency-of-preference": region.currency,
        "x-amzn-device-family": "WebPlayer",
        "x-amzn-music-domain": domain,
        "x-amzn-referer": domain,
        "x-amzn-feature-flags": region.featureFlags || HD_FLAGS,
      }
    : {};
  const payload = { ...body, headers: JSON.stringify(buildAmazonHeaders(cfg, pageUrl, overrides)) };

  const outer = defaultHeaders();
  if (domain) {
    outer.authority = new URL(WEB_SKILL_HOSTS[region.skill]).host;
    outer.origin = `https://${domain}`;
    outer.referer = `https://${domain}/`;
  }

  const res = await retry(
    async () => {
      try {
        const r = await client.post(url, payload, {
          headers: outer,
          timeout: timeout ?? amazonWebConfig.timeouts.skill,
        });
        return r;
      } catch (err) {
        if (err.response) {
          throw new AmazonWebError(
            err.response.data?.message || `Amazon skill API ${err.response.status} on ${url}`,
            err.response.status
          );
        }
        throw new AmazonWebError(`Amazon skill API unreachable on ${url}`);
      }
    },
    {
      // postSkill is a POST — replaying it would re-fire the skill request, so
      // never retry the payload; a GetHomeFeed-style retry lives upstream in
      // the search/refresh paths that own the overall flow.
      retries: 0,
      baseMs: 300,
      maxTotalMs: timeout ?? amazonWebConfig.timeouts.skill,
      shouldRetry: (err) => !(err instanceof AmazonWebError && err.status >= 400 && err.status < 500),
    }
  );
  if (res.status !== 200) {
    throw new AmazonWebError(
      `Failed to fetch data: ${res.data?.message || "Unknown error occurred"}`,
      res.status
    );
  }
  return res.data;
};

// Multi-region by-id lookup (albums/playlists): try the domain hint first,
// then race every regional skill endpoint.
const fetchMultiRegion = async (id, apiPath, urlPathSegment, entityName, domainHint, isErrorResponse) => {
  // One representative domain per skill group (NA/EU/FE) instead of racing all 14.
  const SKILL_REPRESENTATIVES = [
    "music.amazon.com",    // NA
    "music.amazon.co.uk",  // EU
    "music.amazon.co.jp",  // FE
  ];
  const ping = async (domain) => {
    const region = REGION_CONFIG_MAP[domain];
    const cfg = await fetchConfig(domain);
    const pageUrl = `https://${domain}/${urlPathSegment}/${encodeURIComponent(id)}`;
    const data = await postSkill(
      `${WEB_SKILL_HOSTS[region.skill]}${apiPath}`,
      cfg,
      { id, userHash: USER_HASH },
      pageUrl,
      { region, domain, timeout: amazonWebConfig.timeouts.skill }
    );
    if (isErrorResponse(data)) throw new AmazonWebError(`${entityName} not found on ${domain}`, 404);
    return data;
  };

  if (domainHint && REGION_CONFIG_MAP[domainHint]) {
    try {
      return await ping(domainHint);
    } catch (_) {
      // fall through to the fan-out
    }
  }
  try {
    return await Promise.any(SKILL_REPRESENTATIVES.map(ping));
  } catch (_) {
    throw new AmazonWebError(`${entityName} not found on any regional endpoint (NA, EU, FE)`, 404);
  }
};

// ── response predicates ──────────────────────────────────────────────┐

const isEmptyContainer = (tpl) =>
  Array.isArray(tpl.widgets) && tpl.widgets.length === 0 && tpl.templateData?.deeplink === "/";

const isAlbumErrorResponse = (data) => {
  if (!data) return true;
  if (Object.prototype.hasOwnProperty.call(data, "onError")) return true;
  if (!Array.isArray(data.methods) || data.methods.length === 0) return true;
  const tpl = data.methods[0].template || {};
  const iface = String(tpl.interface || "");
  if (iface.includes("DialogTemplate") && tpl.header === "Service error") return true;
  return isEmptyContainer(tpl);
};

const isPlaylistErrorResponse = (data) => {
  if (!data) return true;
  if (Object.prototype.hasOwnProperty.call(data, "onError")) return true;
  if (!Array.isArray(data.methods) || data.methods.length === 0) return true;
  const tpl = data.methods[0].template || {};
  if (isEmptyContainer(tpl)) return true;
  const notification = data.methods[1]?.notification?.message || {};
  const msg = `${notification.text || ""} ${notification.innerHTML || ""}`;
  return msg.includes("playlist is no longer available");
};

const isInvalidTrackResponse = (data) => {
  if (!data) return true;
  if (!Array.isArray(data.methods) || data.methods.length === 0) return true;
  const m0 = data.methods[0];
  if (String(m0.interface || "").includes("ShowNotificationMethod")) {
    const msg = m0.notification?.message?.text || "";
    if (msg.toLowerCase().includes("this track is no longer available")) return true;
  }
  const tpl = m0.template || {};
  if (String(tpl.interface || "").includes("GalleryTemplate") && Array.isArray(tpl.widgets) && tpl.widgets.length === 0) {
    return true;
  }
  return false;
};

const isArtistErrorResponse = (data) => {
  if (!data) return true;
  const tpl = data.methods?.[0]?.template || {};
  if (
    String(tpl.interface || "").includes("MessageTemplate") &&
    tpl.header === "We're Sorry" &&
    JSON.stringify(data.methods[0]).includes("We are unable to complete your action")
  ) {
    return true;
  }
  return false;
};

const isCommunityPlaylistErrorResponse = (data) => {
  if (!data) return true;
  const tpl = data.methods?.[0]?.template || {};
  if (
    String(tpl.interface || "").includes("DialogTemplate") &&
    String(tpl.header || "").toLowerCase() === "service error"
  ) {
    return true;
  }
  return false;
};

// ── helpers ──────────────────────────────────────────────────────────┐

const durationToSeconds = (str) => {
  const s = String(str || "").trim();
  if (!s) return 0;
  const hm = s.match(/^(\d+):(\d+):(\d+)$/);
  if (hm) return parseInt(hm[1], 10) * 3600 + parseInt(hm[2], 10) * 60 + parseInt(hm[3], 10);
  const ms = s.match(/^(\d+):(\d+)$/);
  if (ms) return parseInt(ms[1], 10) * 60 + parseInt(ms[2], 10);
  const bare = s.match(/^\d+$/);
  return bare ? parseInt(bare[0], 10) : 0;
};

const { toProxyUrl } = require("../utils/imageProxy");

const cleanImageUrl = (url) => {
  if (!url) return null;
  if (String(url).includes("_CLa%7C")) {
    let u = String(url);
    u = u.replace(/\._AA\d+\.jpg$/, ".jpg");
    u = u.replace(/_(US|SX|SY)\d+/, "_US1000");
    u = u.replace(/CLa%7C354,354/, "CLa%7C1000,1000");
    const coords = {
      "0,0,354,354": "0,0,1000,1000",
      "0,0,177,177": "0,0,500,500",
      "177,0,177,177": "500,0,500,500",
      "0,177,177,177": "0,500,500,500",
      "177,177,177,177": "500,500,500,500",
      "177,0,500,500": "500,0,500,500",
      "0,500,500,177": "0,500,500,500",
      "500,500,500,177": "500,500,500,500",
    };
    for (const [from, to] of Object.entries(coords)) {
      if (u.includes(from)) {
        u = u.replace(from, to);
        break;
      }
    }
    return toProxyUrl(u);
  }
  return toProxyUrl(String(url).replace(/(\/I\/[A-Za-z0-9+_-]+).*?(\.[^.]+)$/, "$1$2"));
};

const cleanSongTitle = (title) => String(title || "").replace(/^\d+\.\s*/, "");

const MONTHS = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04",
  MAY: "05", JUN: "06", JUL: "07", AUG: "08",
  SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

// headerTertiaryText looks like "12 SONGS • 54 MINUTES • APR 03 2013".
const extractSongsCountFromText = (text) =>
  parseInt(String(text || "").match(/(\d+)\s*SONGS?/i)?.[1], 10) || 0;

const extractDurationFromText = (text = "") => {
  const h = text.match(/(\d+)\s*HOURS?\s*AND\s+(\d+)\s*MINUTES?/i);
  if (h) return parseInt(h[1], 10) * 3600 + parseInt(h[2], 10) * 60;
  const ms = text.match(/(\d+)\s*MINUTES?\s*AND\s+(\d+)\s*SECONDS?/i);
  if (ms) return parseInt(ms[1], 10) * 60 + parseInt(ms[2], 10);
  const mmss = text.match(/(\d+):(\d+)/);
  if (mmss) return parseInt(mmss[1], 10) * 60 + parseInt(mmss[2], 10);
  const mins = text.match(/(\d+)\s*MINUTES?/i);
  if (mins) return parseInt(mins[1], 10) * 60;
  return null;
};

const extractReleaseDateFromText = (text = "") => {
  const m = String(text).match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{1,2})\s+(\d{4})/i);
  if (!m) return null;
  return `${m[3]}-${MONTHS[m[1].toUpperCase()]}-${String(m[2]).padStart(2, "0")}`;
};

const trackIdOf = (deeplink) => String(deeplink || "").split("/tracks/")[1]?.split("/")[0];

// ── duration resolution (secondary album calls) ─────────────────────┐

// Searches/artist-top-tracks don't carry durations on the item itself; the
// duration lives on the matching row of the album's tracklist. Fetch albums
// in batches of 5 with a small delay (mirrors the reference implementation).
const fetchAlbumDurations = async (albumIds, cfg) => {
  const cache = {};
  for (let i = 0; i < albumIds.length; i += 5) {
    const batch = albumIds.slice(i, i + 5);
    await Promise.all(
      batch.map(async (albumId) => {
        try {
          const data = await postSkill(
            ENDPOINTS.album,
            cfg,
            { id: albumId, userHash: USER_HASH },
            `https://music.amazon.com/albums/${albumId}`,
            { timeout: amazonWebConfig.timeouts.durationBatch }
          );
          cache[albumId] = data?.methods?.[0]?.template?.widgets?.[0]?.items || [];
        } catch (_) {
          cache[albumId] = [];
        }
      })
    );
  }
  return cache;
};

const attachDurations = async (songs, cfg) => {
  const albumIds = [...new Set(songs.map((s) => s.album?.id).filter(Boolean))];
  const durations = await fetchAlbumDurations(albumIds, cfg);
  for (const song of songs) {
    if (!song.album?.id) continue;
    const row = (durations[song.album.id] || []).find(
      (item) => trackIdOf(item.primaryTextLink?.deeplink) === song.id
    );
    song.duration = durationToSeconds(row?.secondaryText3 || "");
  }
};

// ── payload builders (scraper models) ───────────────────────────────┐

const parseSearchSongItem = (item) => {
  const [albumId, songId] = String(item.iconButton?.observer?.storageKey || "").split(":");
  if (!songId) return null;
  const albumOptions = item.contextMenu?.options?.[0]?.onItemSelected?.[1];
  const artistSegs = String(item.secondaryLink?.deeplink || "").split("/artists/")[1]?.split("/") || [];
  return {
    id: songId,
    title: item.primaryText?.text || "Unknown Title",
    url: `https://music.amazon.com/tracks/${songId}`,
    image: cleanImageUrl(item.image),
    duration: 0,
    isrc: null,
    artist: {
      id: artistSegs[0] || "",
      name: item.secondaryText || "Unknown Artist",
      url: item.secondaryLink?.deeplink ? `https://music.amazon.com${item.secondaryLink.deeplink}` : "",
    },
    album: {
      id: albumId || "",
      name: albumOptions?.template?.headerText?.text || "Unknown Album",
      url:
        albumOptions?.template?.templateData?.seoHead?.link?.[0]?.href ||
        (albumId ? `https://music.amazon.com/albums/${albumId}` : ""),
    },
  };
};

const parseSearchArtistItem = (item) => ({
  id: String(item.iconButton?.observer?.storageKey || ""),
  name: item.primaryText?.text || "Unknown Artist",
  url: `https://music.amazon.com/artists/${item.iconButton?.observer?.storageKey}`,
  image: cleanImageUrl(item.image),
});

const parseSearchAlbumItem = (item) => {
  const id =
    String(item.iconButton?.observer?.storageKey || "") ||
    String(item.primaryLink?.deeplink || "").split("/albums/")[1]?.split("/")[0];
  const artistSegs = String(item.secondaryLink?.deeplink || "").split("/artists/")[1]?.split("/") || [];
  return {
    id,
    name: item.primaryText?.text || item.primaryText || "Unknown Album",
    url: id ? `https://music.amazon.com/albums/${id}` : "",
    image: cleanImageUrl(item.image),
    artist: {
      id: artistSegs[0] || "",
      name: item.secondaryText || "",
      url: item.secondaryLink?.deeplink ? `https://music.amazon.com${item.secondaryLink.deeplink}` : "",
    },
  };
};

const parseSearchPlaylistItem = (item) => ({
  id: String(item.iconButton?.observer?.storageKey || ""),
  name: item.primaryText?.observer?.defaultValue?.text || item.primaryText?.text || "Unknown Playlist",
  url: `https://music.amazon.com/playlists/${item.iconButton?.observer?.storageKey}`,
  image: cleanImageUrl(item.image),
  createdBy: "Amazon Music",
});

// ── audio resolution ────────────────────────────────────────────────┐

const resolveTracksAudio = async (tracks) => {
  if (!tracks || !tracks.length) return tracks || [];
  return mapLimit(tracks, 5, async (track) => {
    if (!track) return track;
    try {
      const resolved = await resolvePlayableAudio({
        name: track.name,
        artist: track.artist_name,
        audioUrl: track.audio,
        duration: track.duration,
        source: "amazon",
        id: track.id,
      });
      if (resolved.audioUrl && resolved.audioUrl !== track.audio) {
        return { ...track, audio: resolved.audioUrl, duration: resolved.duration || track.duration };
      }
      if (resolved.videoId) {
        return { ...track, videoId: resolved.videoId };
      }
    } catch (_) {}
    return track;
  });
};

// ── search ──────────────────────────────────────────────────────────┐

const searchTracks = async (query, opts = {}) => {
  let page = clampPage(opts.page);
  const limit = clampLimit(opts.limit, 10);
  const cfg = await fetchConfig();
  const body = { keyword: query, userHash: USER_HASH };
  if (page >= 2) {
    if (opts.next) {
      body.next = opts.next;
    } else {
      // Unified search may request page>1 without a continuity token (it only
      // passes page, never the last 'next' token from the first page). Fall
      // back to page 1 instead of dropping the whole provider from results.
      page = 1;
    }
  }
  const data = await postSkill(
    ENDPOINTS.searchTracks,
    cfg,
    body,
    `https://music.amazon.com/search/${encodeURIComponent(query)}/songs`,
    { timeout: amazonWebConfig.timeouts.skill }
  );
  const items = page === 1 ? data?.methods?.[0]?.template?.widgets?.[0]?.items : data?.methods?.[0]?.items;
  if (!Array.isArray(items) || items.length === 0) throw new AmazonWebError("No songs found", 404);
  const songs = items.map(parseSearchSongItem).filter(Boolean);
  if (!songs.length) throw new AmazonWebError("No songs found", 404);
  await attachDurations(songs, cfg);
  return songs.slice(0, limit);
};

const searchAlbums = async (query, opts = {}) => {
  let page = clampPage(opts.page);
  const limit = clampLimit(opts.limit, 25);
  const cfg = await fetchConfig();
  const body = { keyword: query, userHash: USER_HASH };
  if (page >= 2) {
    if (opts.next) {
      body.next = opts.next;
    } else {
      // Unified search may request page>1 without a continuity token (it only
      // passes page, never the last 'next' token from the first page). Fall
      // back to page 1 instead of dropping the whole provider from results.
      page = 1;
    }
  }
  const data = await postSkill(
    ENDPOINTS.searchAlbums,
    cfg,
    body,
    `https://music.amazon.com/search/${encodeURIComponent(query)}/albums`,
    { timeout: amazonWebConfig.timeouts.skill }
  );
  const items = page === 1 ? data?.methods?.[0]?.template?.widgets?.[0]?.items : data?.methods?.[0]?.items;
  if (!Array.isArray(items) || items.length === 0) throw new AmazonWebError("No albums found", 404);
  const albums = items.map(parseSearchAlbumItem).filter((a) => a.id);
  if (!albums.length) throw new AmazonWebError("No albums found", 404);
  return albums.slice(0, limit);
};

const searchArtists = async (query, opts = {}) => {
  let page = clampPage(opts.page);
  const limit = clampLimit(opts.limit, 25);
  const cfg = await fetchConfig();
  const body = { keyword: query, userHash: USER_HASH };
  if (page >= 2) {
    if (opts.next) {
      body.next = opts.next;
    } else {
      // Unified search may request page>1 without a continuity token (it only
      // passes page, never the last 'next' token from the first page). Fall
      // back to page 1 instead of dropping the whole provider from results.
      page = 1;
    }
  }
  const data = await postSkill(
    ENDPOINTS.searchArtists,
    cfg,
    body,
    `https://music.amazon.com/search/${encodeURIComponent(query)}/artists`,
    { timeout: amazonWebConfig.timeouts.skill }
  );
  const items = page === 1 ? data?.methods?.[0]?.template?.widgets?.[0]?.items : data?.methods?.[0]?.items;
  if (!Array.isArray(items) || items.length === 0) throw new AmazonWebError("No artists found", 404);
  const artists = items.map(parseSearchArtistItem).filter((a) => a.id);
  if (!artists.length) throw new AmazonWebError("No artists found", 404);
  return artists.slice(0, limit);
};

const searchPlaylists = async (query, opts = {}) => {
  let page = clampPage(opts.page);
  const limit = clampLimit(opts.limit, 25);
  const cfg = await fetchConfig();
  const body = { keyword: query, userHash: USER_HASH };
  if (page >= 2) {
    if (opts.next) {
      body.next = opts.next;
    } else {
      // Unified search may request page>1 without a continuity token (it only
      // passes page, never the last 'next' token from the first page). Fall
      // back to page 1 instead of dropping the whole provider from results.
      page = 1;
    }
  }
  const data = await postSkill(
    ENDPOINTS.searchPlaylists,
    cfg,
    body,
    `https://music.amazon.com/search/${encodeURIComponent(query)}/playlists`,
    { timeout: amazonWebConfig.timeouts.skill }
  );
  const items = page === 1 ? data?.methods?.[0]?.template?.widgets?.[0]?.items : data?.methods?.[0]?.items;
  if (!Array.isArray(items) || items.length === 0) throw new AmazonWebError("No playlists found", 404);
  const playlists = items.map(parseSearchPlaylistItem).filter((p) => p.id);
  if (!playlists.length) throw new AmazonWebError("No playlists found", 404);
  return playlists.slice(0, limit);
};

// Unified search across the four frontend categories.
const search = async (query, opts = {}) => {
  const type = String(opts.type || "all").toLowerCase();
  // The unified multi-provider search defers audio resolution to play-time
  // (see search.service) — resolving every row here is O(rows) upstream calls
  // and stalls the whole page. Opt out with resolveAudio:false.
  const resolveAudio = opts.resolveAudio !== false;
  const run = (fn) => fn();

  const queries = [];
  if (type === "all" || type === "track") queries.push(["track", () => searchTracks(query, opts)]);
  if (type === "all" || type === "album") queries.push(["album", () => searchAlbums(query, opts)]);
  if (type === "all" || type === "artist") queries.push(["artist", () => searchArtists(query, opts)]);
  if (type === "all" || type === "playlist") queries.push(["playlist", () => searchPlaylists(query, opts)]);
  if (!queries.length) queries.push(["track", () => searchTracks(query, opts)]);

  const results = {};
  let total = 0;
  let firstErr = null;
  const settled = await Promise.allSettled(queries.map(([, fn]) => run(fn)));
  settled.forEach((outcome, i) => {
    const key = queries[i][0];
    if (outcome.status === "fulfilled") {
      results[key] = outcome.value;
      total += outcome.value.length;
    } else {
      results[key] = [];
      firstErr = firstErr || outcome.reason;
    }
  });
  for (const key of ["track", "album", "artist", "playlist"]) {
    if (!results[key]) results[key] = [];
  }
  if (total === 0 && firstErr) throw firstErr;

  switch (type) {
    case "track":
      results.track = resolveAudio
        ? await resolveTracksAudio(results.track.map(normalizeTrack).filter(Boolean))
        : results.track.map(normalizeTrack).filter(Boolean);
      break;
    case "album": results.album = results.album.map(normalizeAlbum).filter(Boolean); break;
    case "artist": results.artist = results.artist.map(normalizeArtist).filter(Boolean); break;
    case "playlist": results.playlist = results.playlist.map(normalizePlaylist).filter(Boolean); break;
    default:
      results.track = resolveAudio
        ? await resolveTracksAudio(results.track.map(normalizeTrack).filter(Boolean))
        : results.track.map(normalizeTrack).filter(Boolean);
      results.album = results.album.map(normalizeAlbum).filter(Boolean);
      results.artist = results.artist.map(normalizeArtist).filter(Boolean);
      results.playlist = results.playlist.map(normalizePlaylist).filter(Boolean);
  }
  return { total, results };
};

// ── by-id lookups ───────────────────────────────────────────────────┐

const getTrackById = async (id) => {
  try {
    const cfg = await fetchConfig();
    const data = await postSkill(
      ENDPOINTS.track,
      cfg,
      { id, userHash: USER_HASH },
      `https://music.amazon.com/tracks/${id}`,
      { timeout: amazonWebConfig.timeouts.skill }
    );
    if (isInvalidTrackResponse(data)) throw new AmazonWebError("Track not found", 404);
    const template = data.methods[0].template;

    let duration = 0;
    const tracklist = (template.widgets || []).find((w) => String(w.header || "").toLowerCase().includes("album tracklist"));
    if (tracklist) {
      const row = (tracklist.items || []).find((i) => trackIdOf(i.primaryTextLink?.deeplink) === id);
      duration = durationToSeconds(row?.secondaryText3 || "");
    }

    let isrc = null;
    for (const script of template.templateData?.seoHead?.script || []) {
      try {
        const parsed = JSON.parse(script.innerHTML);
        if (parsed.isrcCode) {
          isrc = parsed.isrcCode;
          break;
        }
      } catch (_) {
        // not a JSON script block
      }
    }

    const albumOption = template.contextMenu?.options?.[1]?.onItemSelected?.[1]?.template;
    const albumId = albumOption?.templateData?.deeplink?.split("/albums/")[1]?.split("/")[0];
    const album = albumId
      ? {
          id: albumId,
          name: albumOption.headerText?.text || "",
          url: albumOption.templateData?.seoHead?.link?.[0]?.href || `https://music.amazon.com/albums/${albumId}`,
        }
      : { id: "", name: "", url: "" };

    let artist = { id: "", name: template.headerPrimaryText || "", url: "" };
    if (template.headerPrimaryTextLink?.deeplink) {
      const artistId = template.headerPrimaryTextLink.deeplink.split("/artists/")[1]?.split("/")[0];
      artist = { id: artistId || "", name: template.headerPrimaryText || "", url: `https://music.amazon.com${template.headerPrimaryTextLink.deeplink}` };
    }

    const track = normalizeTrack({
      id,
      title: template.headerText?.text || "Unknown Title",
      url: `https://music.amazon.com/tracks/${id}`,
      image: cleanImageUrl(template.headerImage),
      duration,
      isrc,
      album,
      artist,
    });
    if (!track) return null;
    const resolved = await resolveTracksAudio([track]);
    return resolved[0] || track;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

const getAlbumById = async (id, domainHint) => {
  try {
    const data = await fetchMultiRegion(id, "/api/showCatalogAlbum", "albums", "Album", domainHint, isAlbumErrorResponse);
    const template = data.methods[0].template;
    const artistLink = template.headerPrimaryTextLink?.deeplink || "";
    const artistId = artistLink.split("/artists/")[1]?.split("/")[0] || "";
    const artistName = template.headerPrimaryText || "";

    const songs = (template.widgets?.[0]?.items || [])
      .map((item) => {
        const trackId = trackIdOf(item.primaryTextLink?.deeplink);
        if (!trackId) return null;
        const songArtistId = item.secondaryText2Link?.deeplink?.split("/artists/")[1]?.split("/")[0];
        return {
          id: trackId,
          title: item.primaryText || "",
          url: `https://music.amazon.com/tracks/${trackId}`,
          image: cleanImageUrl(template.headerImage),
          duration: durationToSeconds(item.secondaryText3 || ""),
          isrc: null,
          artist: {
            id: songArtistId || artistId,
            name: item.secondaryText2 || artistName,
            url: item.secondaryText2Link?.deeplink
              ? `https://music.amazon.com${item.secondaryText2Link.deeplink}`
              : artistLink
                ? `https://music.amazon.com${artistLink}`
                : "",
          },
          album: { id, name: template.headerText?.text || "", url: `https://music.amazon.com/albums/${encodeURIComponent(id)}` },
        };
      })
      .filter(Boolean);

    const album = normalizeAlbum({
      id,
      name: template.headerText?.text || "",
      image: cleanImageUrl(template.headerImage),
      totalSongs: extractSongsCountFromText(template.headerTertiaryText),
      totalDuration: extractDurationFromText(template.headerTertiaryText),
      releaseDate: extractReleaseDateFromText(template.headerTertiaryText),
      artist: { id: artistId, name: artistName, url: artistLink ? `https://music.amazon.com${artistLink}` : "" },
      songs,
    });
    if (album && album.songs && album.songs.length) {
      album.songs = await resolveTracksAudio(album.songs);
    }
    return album;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

const getArtistById = async (id) => {
  try {
    const cfg = await fetchConfig();
    const data = await postSkill(
      ENDPOINTS.artist,
      cfg,
      { id, userHash: USER_HASH },
      `https://music.amazon.com/artists/${id}`,
      { timeout: amazonWebConfig.timeouts.skill }
    );
    if (isArtistErrorResponse(data)) throw new AmazonWebError("Artist not found", 404);
    const template = data.methods[0].template;
    const widgets = template.widgets || [];
    const topWidget = widgets.find((w) => String(w.header || "").toLowerCase().includes("top songs"));

    const albumIds = [
      ...new Set(
        (topWidget?.items || [])
          .map((item) => String(item.iconButton?.observer?.storageKey || "").split(":")[0])
          .filter(Boolean)
      ),
    ];
    const durations = await fetchAlbumDurations(albumIds, cfg);

    const topSongs = (topWidget?.items || [])
      .map((item) => {
        const [albumId, trackId] = String(item.iconButton?.observer?.storageKey || "").split(":");
        if (!trackId) return null;
        const albumName = item.contextMenu?.options?.[0]?.onItemSelected?.[1]?.template?.headerText?.text || "";
        const artistUrl = item.contextMenu?.options?.[1]?.onItemSelected?.[2]?.template?.templateData?.seoHead?.link?.[0]?.href || "";
        let duration = 0;
        if (albumId) {
          const row = (durations[albumId] || []).find((r) => trackIdOf(r.primaryTextLink?.deeplink) === trackId);
          duration = durationToSeconds(row?.secondaryText3 || "");
        }
        return {
          id: trackId,
          title: cleanSongTitle(item.primaryText?.text),
          url: `https://music.amazon.com/tracks/${encodeURIComponent(trackId)}`,
          image: cleanImageUrl(item.image),
          duration,
          isrc: null,
          album: { id: albumId || "", name: albumName, url: albumId ? `https://music.amazon.com/albums/${encodeURIComponent(albumId)}` : "" },
          artist: { id, name: item.secondaryText || "", url: artistUrl },
        };
      })
      .filter(Boolean);

    return {
      artist: normalizeArtist({
        id,
        name: template.headerText?.text || "",
        image: cleanImageUrl(template.backgroundImage || template.headerImage),
        url: `https://music.amazon.com/artists/${encodeURIComponent(id)}`,
      }),
      topSongs: await resolveTracksAudio(topSongs.map(normalizeTrack).filter(Boolean)),
    };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

const getPlaylistById = async (id, domainHint) => {
  try {
    const data = await fetchMultiRegion(id, "/api/showCatalogPlaylist", "playlists", "Playlist", domainHint, isPlaylistErrorResponse);
    const template = data.methods[0].template;
    const songs = (template.widgets?.[0]?.items || [])
      .map((item) => {
        const [albumId, trackId] = String(item.iconButton?.observer?.storageKey || "").split(":");
        if (!trackId) return null;
        const artistId = item.secondaryText1Link?.deeplink?.split("/artists/")[1]?.split("/")[0];
        return {
          id: trackId,
          title: item.primaryText || "",
          url: `https://music.amazon.com/tracks/${encodeURIComponent(trackId)}`,
          image: cleanImageUrl(item.image),
          duration: durationToSeconds(item.secondaryText3 || ""),
          isrc: null,
          album: { id: albumId || "", name: item.secondaryText2 || "", url: albumId ? `https://music.amazon.com/albums/${encodeURIComponent(albumId)}` : "" },
          artist: {
            id: artistId || "",
            name: item.secondaryText1 || "",
            url: item.secondaryText1Link?.deeplink ? `https://music.amazon.com${item.secondaryText1Link.deeplink}` : "",
          },
        };
      })
      .filter(Boolean);

    const playlist = normalizePlaylist({
      id,
      name: template.headerText?.text || "",
      image: cleanImageUrl(template.headerImage),
      totalSongs: extractSongsCountFromText(template.headerTertiaryText),
      totalDuration: extractDurationFromText(template.headerTertiaryText),
      createdBy: "Amazon Music",
      songs,
    });
    if (playlist && playlist.songs && playlist.songs.length) {
      playlist.songs = await resolveTracksAudio(playlist.songs);
    }
    return playlist;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

const getCommunityPlaylistById = async (id) => {
  try {
    const cfg = await fetchConfig();
    const data = await postSkill(
      ENDPOINTS.communityPlaylist,
      cfg,
      { id, userHash: USER_HASH },
      `https://music.amazon.com/user-playlists/${id}`,
      { timeout: amazonWebConfig.timeouts.skill }
    );
    if (isCommunityPlaylistErrorResponse(data)) throw new AmazonWebError("Community playlist not found", 404);
    const template = data.methods[0].template;
    const songs = (template.widgets?.[0]?.items || [])
      .map((item) => {
        const trackId = String(item.id || "");
        if (!trackId) return null;
        const artistId = item.secondaryText1Link?.deeplink?.split("/artists/")[1]?.split("/")[0];
        return {
          id: trackId,
          title: item.primaryText || "",
          url: `https://music.amazon.com/tracks/${trackId}`,
          image: cleanImageUrl(item.image),
          duration: durationToSeconds(item.secondaryText3 || ""),
          isrc: null,
          album: { id: "", name: item.secondaryText2 || "", url: item.secondaryText2Link?.deeplink ? `https://music.amazon.com${item.secondaryText2Link.deeplink}` : "" },
          artist: { id: artistId || "", name: item.secondaryText1 || "", url: item.secondaryText1Link?.deeplink ? `https://music.amazon.com${item.secondaryText1Link.deeplink}` : "" },
        };
      })
      .filter(Boolean);

    return normalizePlaylist({
      id,
      name: template.headerText?.text || "",
      image: cleanImageUrl(template.headerImage),
      totalSongs: songs.length,
      totalDuration: songs.reduce((sum, s) => sum + (s.duration || 0), 0),
      createdBy: "Community User",
      songs,
    });
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

module.exports = {
  search,
  getTrackById,
  getAlbumById,
  getArtistById,
  getPlaylistById,
  getCommunityPlaylistById,
  // exposed for targeted tests
  _internals: {
    AmazonWebError,
    durationToSeconds,
    cleanImageUrl,
    cleanSongTitle,
    extractSongsCountFromText,
    extractDurationFromText,
    extractReleaseDateFromText,
  },
};