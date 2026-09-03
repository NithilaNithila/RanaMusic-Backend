const saavnService = require("./saavn.service");
const spotifyService = require("./spotify.service");
const ytService = require("./ytmusic.service");
const amazonService = require("./amazon.service");
const { memoize, makeCacheKey } = require("./cache.service");
const SEARCH_TTL = 300; // 5 min - unified search hits 4 external APIs

const clampLimit = (limit) => Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
const clampOffset = (offset) => Math.max(parseInt(offset, 10) || 0, 0);

const lower = (v) => String(v || "").trim().toLowerCase();

const firstArtist = (artistName) => String(artistName || "").split(",")[0].trim();

const trackKey = (t) => `${lower(t.name)}|${lower(firstArtist(t.artist_name))}`;
const albumKey = (a) =>
  `${lower(a.name)}|${lower(a.artist_name || (Array.isArray(a.artists) ? a.artists.map((x) => x?.name || x).join(", ") : "") || "")}`;
const artistKey = (a) => `${lower(a.name)}`;
const playlistKey = (p) => `${lower(p.name)}`;

const KEYS = { track: trackKey, album: albumKey, artist: artistKey, playlist: playlistKey };

const TYPES = ["track", "album", "artist", "playlist"];

// Response keys are plural while provider types are singular.
const PLURAL = { track: "tracks", album: "albums", artist: "artists", playlist: "playlists" };

const resolveTypes = (type) => {
  if (!type || type === "all") return TYPES;
  const requested = String(type)
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => TYPES.includes(t));
  return requested.length ? requested : TYPES;
};

const merge = (arrays, keyFn, limit) => {
  const seen = new Set();
  const out = [];
  for (const arr of arrays) {
    for (const entry of arr || []) {
      if (!entry) continue;
      const key = String(keyFn(entry) || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
      if (out.length >= limit) return out;
    }
  }
  return out;
};

const safe = (fn) => Promise.resolve().then(fn).catch(() => null);

// Tags every result with the provider it came from so the UI can route
// (playlists -> ?source=...) and show the right source label.
const tag = (items, source) =>
  (items || []).map((it) => (it && typeof it === "object" ? { ...it, source } : it));

const searchByType = async ({ query, type, limit, page, offset }) => {
  const fetchers = [];

  if (type === "track") {
    fetchers.push(
      safe(() => saavnService.searchTracks(query, { page, limit }).then((d) => tag(d && d.results, "saavn")))
    );
  } else if (type === "album") {
    fetchers.push(
      safe(() => saavnService.searchAlbums(query, { page, limit }).then((d) => tag(d && d.results, "saavn")))
    );
  } else if (type === "artist") {
    fetchers.push(
      safe(() => saavnService.searchArtists(query, { page, limit }).then((d) => tag(d && d.results, "saavn")))
    );
  }

  fetchers.push(
    safe(() =>
      spotifyService.search(query, { type, limit, offset }).then((d) => tag(d && d.results && d.results[type], "spotify"))
    ),
    safe(() =>
      ytService.search(query, { type, limit, offset }).then((d) => tag(d && d.results && d.results[type], "ytmusic"))
    ),
    safe(() =>
      amazonService.search(query, { type, limit, page }).then((d) => tag(d && d.results && d.results[type], "amazon"))
    )
  );

  const settled = await Promise.allSettled(fetchers);
  const arrays = settled
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value)
    .filter(Boolean);

  return merge(arrays, KEYS[type], limit);
};

const search = async (query, opts = {}) => {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  const page = Math.floor(offset / limit) + 1;
  const types = resolveTypes(opts.type);

  // Memoize so concurrent identical searches share one upstream fetch.
  const key = makeCacheKey("search:svc", { q: lower(query), type: types.join(","), limit, offset });
  return memoize(key, SEARCH_TTL, async () => {
    const results = {};
    let total = 0;

    await Promise.all(
      types.map(async (type) => {
        const merged = await searchByType({ query, type, limit, page, offset });
        results[type] = merged;
        total += merged.length;
      })
    );

    for (const type of TYPES) {
      if (!results[type]) results[type] = [];
    }

    const payload = {};
    for (const type of TYPES) {
      payload[PLURAL[type]] = results[type];
    }

    return { total, results: payload };
  });
};

module.exports = { search, resolveTypes };