const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const spotifyService = require("../services/spotify.service");
const amazonService = require("../services/amazon.service");
const saavnService = require("../services/saavn.service");
const { makeCacheKey, memoize } = require("../services/cache.service");
const { getDayIndex } = require("../utils/dayRotation");

const SOURCES = [
  { source: "spotify", service: spotifyService },
  { source: "amazon", service: amazonService },
  { source: "saavn", service: { search: (q, opts) => saavnService.searchPlaylists(q, opts) } },
];

const CATALOG_QUERIES = [
  "Top Hits",
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
  "Gym",
  "Sad Songs",
  "Bollywood",
  "Melodies",
  "Indie",
  "Hits 2024",
];

const MAX_PER_SOURCE = 500;
const CATALOG_CAP = 500;
// Curated provider playlists change rarely, but the Home "Curated Playlists"
// feed is meant to feel fresh day-to-day, so the build is keyed by calendar day
// (see getDayIndex) and the cache TTL is kept modest. A new day => a new build
// even if the underlying provider catalogs are stable.
const CATALOG_TTL_SECONDS = 60 * 60; // 1 hour (day-key already forces a daily rebuild)

const fetchQueryPlaylists = (service, q) =>
  service
    .search(q, { type: "playlist", limit: 30 })
    .then((data) => {
      // Provider services return { results: { playlist: [...] } }; Saavn
      // returns { results: [...] }. Normalize both to a plain array.
      const r = data?.results;
      if (Array.isArray(r)) return r;
      if (Array.isArray(r?.playlist)) return r.playlist;
      return [];
    })
    .catch(() => []);

const normalizeTitle = (title) =>
  String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const hasImage = (p) => Boolean(String(p?.image || "").trim());

// Curated provider CDNs hand back huge originals (1200px+ / 2400x2400px).
// Rendering a grid of those at once overflows the app's native bitmap memory
// pool, so the server downsizes every cover to a compact card-sized image.
const downscaleImage = (url = "") => {
  const s = String(url || "");
  if (!s) return s;

  // Amazon product images `images/I/<id>.jpg` -> `images/I/<id>._SX500_.jpg`.
  if (/m\.media-amazon\.com\/images\/I\//i.test(s)) {
    return s.replace(/\.jpg$/i, "._SX500_.jpg");
  }

  // Spotify CDN `i.scdn.co/image/<id>` accepts a `?w=x&h=y` size hint.
  if (/i\.scdn\.co\/image\//i.test(s)) {
    return s.split("?")[0] + "?w=500&h=500";
  }

  // Spotify mosaic tiles `mosaic.scdn.co/640/...` include the tile size.
  if (/mosaic\.scdn\.co\/\d+\//i.test(s)) {
    return s.replace(/(\/mosaic\.scdn\.co\/)\d+\//i, "$1300/");
  }

  return s;
};

// Enrich playlists that came back without a provider cover by matching them
// against the Saavn playlist catalog (same-name search takes the top hit's
// artwork). Best-effort: failures leave the placeholder fallback in place.
// Bounded concurrency (ENRICH_CONCURRENCY) prevents a cold-cache burst of
// hundreds of simultaneous best-effort Saavn lookups from tripping upstream
// rate limits; results are per-item and independent, so limiting concurrency
// does not change which images are resolved, only how many requests fly at once.
const ENRICH_CONCURRENCY = 8;

const enrichMissingImages = async (playlists) => {
  const missing = playlists.filter((p) => !hasImage(p) && p?.name);
  if (!missing.length) return playlists;

  // Process `missing` in fixed-size windows. Each window's items run in
  // parallel; the next window starts only after the previous settles.
  const covers = [];
  for (let i = 0; i < missing.length; i += ENRICH_CONCURRENCY) {
    const window = missing.slice(i, i + ENRICH_CONCURRENCY);
    const settled = await Promise.all(
      window.map(async (p) => {
        try {
          const { results } = await saavnService.searchPlaylists(p.name, { page: 1, limit: 3 });
          const hit = (results || []).find((r) => hasImage(r));
          return { name: p.name, image: hit?.image || "" };
        } catch {
          return { name: p.name, image: "" };
        }
      })
    );
    covers.push(...settled);
  }

  const byName = new Map(covers.map((c) => [normalizeTitle(c.name), c.image || ""]));

  return playlists.map((p) =>
    hasImage(p) ? p : { ...p, image: byName.get(normalizeTitle(p.name)) || p.image || "" }
  );
};

const getCatalogPlaylists = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), CATALOG_CAP);
  const cacheKey = makeCacheKey("catalog:playlists", { day: getDayIndex() });

  // memoize both caches the result (under cacheKey, TTL) AND deduplicates
  // concurrent cache-miss requests (thundering-herd protection). The old code
  // mirrored getCache/setCache here, storing the same payload twice.
  const merged = await memoize(cacheKey, CATALOG_TTL_SECONDS, async () => {
    const seenIds = new Set();
    const seenNames = new Set();
    const result = [];

    // Fetch all providers in parallel (each does its 10 queries in
    // Promise.all), so the expensive build is bounded by the slowest
    // single provider rather than the sum of all three.
    const perSource = await Promise.all(
      SOURCES.map(async ({ source, service }) => {
        const pages = await Promise.all(CATALOG_QUERIES.map((q) => fetchQueryPlaylists(service, q)));
        return { source, playlists: pages.flat() };
      })
    );

    for (const { source, playlists } of perSource) {
      if (result.length >= CATALOG_CAP) break;

      let sourceCount = 0;
      for (const playlist of playlists) {
        if (!playlist?.id || !playlist.name) continue;
        const idKey = `${source}:${playlist.id}`;
        if (seenIds.has(idKey)) continue;
        const normalized = normalizeTitle(playlist.name);
        if (normalized && seenNames.has(normalized)) continue;
        if (normalized) seenNames.add(normalized);

        seenIds.add(idKey);
        result.push({ ...playlist, source, image: downscaleImage(playlist.image) });
        sourceCount += 1;

        if (sourceCount >= MAX_PER_SOURCE || result.length >= CATALOG_CAP) break;
      }
    }

    const capped = result.slice(0, CATALOG_CAP);
    return enrichMissingImages(capped);
  });

  return ApiResponse.success(res, merged.slice(0, limit), `Found ${Math.min(merged.length, limit)} playlists`);
});

module.exports = { getCatalogPlaylists };