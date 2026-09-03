// Daily-rotating "Home / Discover" feed.
//
// Composes four trending card sections (tracks, albums, artists, playlists)
// that change every calendar day so the frontend shows fresh cards each day.
//
// - Tracks & albums reuse the SAME cached daily pools as /tracks/popular and
//   /albums (shared cache keys -> no duplicate upstream calls, identical data).
// - Artists reuse the "artists on the rise" roster (shared pool per lang).
// - Playlists are built from a rotating subset of source queries, merged
//   across three providers and cached per calendar day.
//
// Every section degrades gracefully: if one upstream fails, that section is
// simply returned empty instead of failing the whole feed.
const saavnService = require("./saavn.service");
const spotifyService = require("./spotify.service");
const ytmusicService = require("./ytmusic.service");
const amazonService = require("./amazon.service");
const { getCache, setCache, makeCacheKey, memoize } = require("./cache.service");
const { getDayIndex, pickBlocks } = require("../utils/dayRotation");
const { getPopularPool } = require("../utils/popularPool");
const { sanitizeLang, TRACK_QUERIES, ALBUM_QUERIES } = require("../config/languages");
const { getArtistPool } = require("../utils/artistPool");

// Default card counts per section.
const DEFAULTS = { tracks: 12, albums: 12, artists: 8, playlists: 12 };

const clamp = (v, fallback, min, max) => {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

// The daily pool is cached 10 min (same as the standalone endpoints), so the
// feed serves slices instantly after the first build of the day.
const POOL_TTL = 600; // seconds

const getTracks = (lang, limit) =>
  getPopularPool({
    poolPrefix: "tracks:popular-pool",
    lang,
    searchFn: saavnService.searchTracks,
    queryList: TRACK_QUERIES[lang],
    ttl: POOL_TTL,
    options: { pageSize: 40, maxPages: 15, cap: 500 },
  }).then((pool) => pool.slice(0, limit));

const getAlbums = (lang, limit) =>
  getPopularPool({
    poolPrefix: "albums:popular-pool",
    lang,
    searchFn: saavnService.searchAlbums,
    queryList: ALBUM_QUERIES[lang],
    ttl: POOL_TTL,
    options: { pageSize: 40, maxPages: 15, cap: 500 },
  }).then((pool) => pool.slice(0, limit));

const getArtists = (lang, limit) =>
  getArtistPool(lang).then((pool) => pool.slice(0, limit));

// ---------------------------------------------------------------------------
// Playlists (daily rotation)
// ---------------------------------------------------------------------------

// Source queries used to build the trending-playlist section. A small, rotating
// subset is picked each day so the cards change daily without hammering the
// upstreams with the full list on every build.
const PLAYLIST_QUERIES = [
  "Top Hits",
  "New Music",
  "Lo-Fi",
  "EDM",
  "Rock",
  "Hip Hop",
  "Chill",
  "Pop",
  "Party",
  "Workout",
  "Retro",
  "Romance",
  "Focus",
  "Sleep",
  "Mood",
  "Trending",
  "Dance",
  "Acoustic",
  "Indie",
  "Country",
  "Jazz",
  "Classical",
  "Instrumental",
  "Gaming",
  "Kids",
  "Travel",
  "Cooking",
  "Sad Songs",
  "Happy Hits",
  "Morning",
  "Evening",
  "R&B",
];

const PLAYLIST_SOURCES = [
  { source: "spotify", service: spotifyService },
  { source: "ytmusic", service: ytmusicService },
  { source: "amazon", service: amazonService },
];

const PLAYLIST_BLOCK_SIZE = 4; // how many queries form one day's block
const PLAYLIST_BLOCKS_PER_DAY = 2; // how many blocks play each day (8 queries)
const PLAYLIST_CAP = 24;
const PLAYLIST_PER_SOURCE = 12;

const normalizeTitle = (title) =>
  String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

// Tags each playlist with its provider and gives it a stable cross-provider
// key so the same playlist from two sources isn't shown twice.
const tagWith = (items, source) =>
  (items || [])
    .filter((p) => p && p.id && p.name)
    .map((p) => ({ ...p, source, dedupe: `${source}:${p.id}` }));

const buildPlaylists = async (queries) => {
  const seen = new Set();
  const merged = [];
  const totalBySource = { spotify: 0, ytmusic: 0, amazon: 0 };

  for (const { source, service } of PLAYLIST_SOURCES) {
    if (merged.length >= PLAYLIST_CAP) break;

    const settled = await Promise.allSettled(
      queries.map((q) =>
        service.search(q, { type: "playlist", limit: 30 })
      )
    );

    for (const attempt of settled) {
      if (attempt.status !== "fulfilled") continue;
      const playlists = tagWith(attempt.value.results?.playlist, source);
      for (const pl of playlists) {
        const norm = normalizeTitle(pl.name);
        if (!norm || seen.has(norm) || seen.has(pl.dedupe)) continue;
        seen.add(norm);
        seen.add(pl.dedupe);
        merged.push(pl);
        totalBySource[source] += 1;
        if (merged.length >= PLAYLIST_CAP || totalBySource[source] >= PLAYLIST_PER_SOURCE) {
          break;
        }
      }
    }
  }

  return merged.slice(0, PLAYLIST_CAP).map(({ dedupe, ...rest }) => rest);
};

const getPlaylists = async (lang, limit) => {
  // Rotate the query subset by calendar day (the lang is ignored for the
  // generic genre list but kept in the key to vary per-language builds too).
  const queries = pickBlocks(PLAYLIST_QUERIES, PLAYLIST_BLOCK_SIZE, PLAYLIST_BLOCKS_PER_DAY);

  // Cache the day's block for 2 days (the key already includes the day, so
  // tomorrow's request builds fresh cards under a new key).
  const day = getDayIndex();
  const cacheKey = makeCacheKey("discover:playlists", { lang, day });
  const DAY_TTL = 48 * 60 * 60; // seconds

  // memoize guards against concurrent cache-miss thundering herds.
  const list = await memoize(cacheKey, DAY_TTL, () => buildPlaylists(queries));
  return list.slice(0, limit);
};

// ---------------------------------------------------------------------------
// Main feed
// ---------------------------------------------------------------------------

const buildFeed = async (opts = {}) => {
  const lang = sanitizeLang(opts.lang);
  const tracks = clamp(opts.limit, DEFAULTS.tracks, 1, 50);
  const albums = clamp(opts.limit, DEFAULTS.albums, 1, 50);
  const artists = clamp(opts.limit, DEFAULTS.artists, 1, 50);
  const playlists = clamp(opts.limit, DEFAULTS.playlists, 1, 50);

  // Each section is independent; a provider hiccup must not sink the feed.
  const [tList, aList, arList, pList] = await Promise.allSettled([
    getTracks(lang, tracks),
    getAlbums(lang, albums),
    getArtists(lang, artists),
    getPlaylists(lang, playlists),
  ]);

  return {
    lang,
    day: getDayIndex(),
    generatedAt: new Date().toISOString(),
    sections: {
      tracks: tList.status === "fulfilled" ? tList.value : [],
      albums: aList.status === "fulfilled" ? aList.value : [],
      artists: arList.status === "fulfilled" ? arList.value : [],
      playlists: pList.status === "fulfilled" ? pList.value : [],
    },
  };
};

module.exports = { buildFeed };
