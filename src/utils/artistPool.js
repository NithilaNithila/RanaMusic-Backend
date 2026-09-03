// Shared "artists on the rise" pool builder.
//
// Centralised so both /api/artists (through the controller) and /api/discover
// reuse the exact same daily-rotating, deduplicated artist roster (same TTL,
// same day rotation, same in-flight de-duplication) without the feed depending
// on a controller module.
const saavnService = require("../services/saavn.service");
const { getDayIndex, pickBlocks } = require("./dayRotation");
const { ARTIST_SEEDS } = require("../config/languages");

// Upstream searches run in small chunks so we don't trip rate limits.
const ARTIST_CHUNK = 8;
const RESULTS_PER_SEED = 3;
// How many seed blocks play each day; rotated so the "artists on the rise"
// roster changes every day instead of listing the same names forever.
const SEED_BLOCKS_PER_DAY = 3;
// The pool is frozen for this long so consecutive pagination requests
// slice from the same, stable list (upstream orderings drift request to
// request, which used to cause overlapping pages).
const ARTIST_POOL_TTL_MS = 10 * 60 * 1000;
let artistPoolCache = { builtAt: 0, list: null, dayIndex: -1, lang: null };
let artistPoolPromise = null;

// Builds (once, per TTL, per calendar day and per language) the full
// deduped "artists on the rise" pool and returns the frozen list. Shared by
// every offset/page request so pages are guaranteed non-overlapping.
const getArtistPool = async (lang = "hi") => {
  const today = getDayIndex();
  if (
    artistPoolCache.list &&
    artistPoolCache.lang === lang &&
    artistPoolCache.dayIndex === today &&
    Date.now() - artistPoolCache.builtAt < ARTIST_POOL_TTL_MS
  ) {
    return artistPoolCache.list;
  }
  if (artistPoolPromise) return artistPoolPromise;

  artistPoolPromise = (async () => {
    const seeds = pickBlocks(
      ARTIST_SEEDS[lang] || ARTIST_SEEDS.hi,
      ARTIST_CHUNK,
      SEED_BLOCKS_PER_DAY
    );
    const seen = new Set();
    // The top result of each seed query is the famous match itself (Arijit
    // Singh for "arijit singh", ...). Those lead the list; the extra matches
    // that came along follow behind.
    const popular = [];
    const remaining = [];

    for (let i = 0; i < seeds.length; i += ARTIST_CHUNK) {
      const chunk = seeds.slice(i, i + ARTIST_CHUNK);
      const settled = await Promise.allSettled(
        chunk.map((q) =>
          saavnService.searchArtists(q, { page: 0, limit: RESULTS_PER_SEED })
        )
      );
      for (const attempt of settled) {
        if (attempt.status !== "fulfilled") continue;
        const found = (attempt.value.results || []).filter(
          (a) => a && a.id && !seen.has(a.id)
        );
        for (const artist of found) {
          seen.add(artist.id);
        }
        if (found[0]) popular.push(found[0]);
        remaining.push(...found.slice(1));
      }
    }

    // Artists providing an image always rank above imageless ones within
    // their group, so clients never show placeholder tiles before portraits.
    const byImage = (a, b) => {
      const av = a.image && a.image.trim() ? 0 : 1;
      const bv = b.image && b.image.trim() ? 0 : 1;
      return av - bv;
    };
    // All artists with artwork lead the pool, so clients show portrait
    // tiles first; the imageless ones follow on later pages.
    const list = [...popular, ...remaining].sort(byImage);
    artistPoolCache = { builtAt: Date.now(), list, dayIndex: today, lang };
    return list;
  })().finally(() => {
    artistPoolPromise = null;
  });

  return artistPoolPromise;
};

module.exports = { getArtistPool };
