const saavnService = require("./saavn.service");
const spotifyService = require("./spotify.service");
const amazonWebService = require("./amazonWeb.service");
const ytmusicService = require("./ytmusicSearch.service");
const { memoize, makeCacheKey } = require("./cache.service");
const { resolvePlayableAudio, resolveSaavnOnly, isPreviewAudioUrl } = require("./trackResolver.service");
const mapLimit = require("../utils/mapLimit");
const SEARCH_TTL = 600; // 5 min - unified search hits 4 provider APIs
// Covers change slowly; 24h for image lookups so repeated searches hit a warm cache.
const IMAGE_FILL_TTL = 86400;

// The search page resolves MANY rows at once. Enrichment (merged list,
// source-tab lists, image fills) runs under ONE shared clock so a cold or slow
// upstream can never push a search past this ceiling; on timeout the raw rows
// are returned (unresolved tracks still play via /tracks/resolve at play time).
const ENRICH_TOTAL_BUDGET_MS = 9000;
const makeEnrichClock = () => {
  const start = Date.now();
  return { start, left: () => Math.max(0, ENRICH_TOTAL_BUDGET_MS - (Date.now() - start)) };
};

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

// Merges provider results without duplicating the same track/album/artist/
// playlist. Iterates every provider array in lockstep (round-robin) instead of
// draining each array in turn, so when a provider is crowded the page still
// shows results from all provider APIs.
const merge = (arrays, keyFn, limit) => {
  const seen = new Set();
  const out = [];
  let i = 0;
  let pending = true;
  while (pending && out.length < limit) {
    pending = false;
    for (const arr of arrays) {
      if (!arr || i >= arr.length) continue;
      pending = true;
      const entry = arr[i];
      if (!entry) continue;
      const key = String(keyFn(entry) || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
      if (out.length >= limit) return out;
    }
    i += 1;
  }
  return out;
};

const safe = (fn) => Promise.resolve().then(fn).catch(() => null);

// Free-tier providers (scraper APIs) can stall for a minute+ when sleeping or
// rate-limited. A slow/dead provider must not hold the whole search hostage:
// each gets its own budget (allowing for provider-specific work like
// Spotify/Amazon audio resolution), and healthy providers fill the page while a
// slow one keeps retrying in the background.
// Free-tier scrapers can stall for minutes when sleeping/rate-limited. A slow
// or dead provider must not hold the search hostage; each gets a budget and
// healthy providers fill the page while a slow one drops out (its group is
// back-filled from Saavn below). Budgets stay under a ~10s ceiling so a cold
// search never forces the user to stare at the skeleton for long.
const PROVIDER_TIMEOUTS = {
  saavn: 9000,
  spotify: 10000, // wolfX search (up to 12s) + per-track audio resolution
  amazon: 9000, // config.json + skill POST + duration lookups
  ytmusic: 8000, // innertube search POST (fast when healthy)
};

// Bounds a provider fetch; on timeout it contributes nothing to the merge.
// The timer is cleared once the fetch settles so a fast provider doesn't leak
// timers, and unref'd + new Promise so it can't keep the process alive.
const withDeadline = (ms, promise) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    if (typeof timer.unref === "function") timer.unref();
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });

const bounded = (fn, ms) => withDeadline(ms, safe(fn));

// Tags every result with the provider it came from so the UI can route
// (playlists -> ?source=...) and show the right source label.
const tag = (items, source) =>
  (items || []).map((it) => (it && typeof it === "object" ? { ...it, source } : it));

// ── image fill ──────────────────────────────────────────────────────┐
// Guarantees every returned row (track/album/artist/playlist) carries an
// image. Rows that already have one are untouched. Rows with an empty or
// whitespace image are filled from the best Saavn match via a memoized
// lookup, so Repeated searches hit cache instead of the upstream API.

const normSearch = (v) =>
  String(v || "")
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const rowArtists = (item) =>
  item.artist_name ||
  (Array.isArray(item.artists)
    ? item.artists.map((a) => (a && typeof a === "object" ? a.name : a)).filter(Boolean).join(", ")
    : "") ||
  "";

// Picks the closest (title, artist) match so a rare track doesn't pick up a
// wrong cover; falls back to the first row when the caption is empty.
const bestImageMatch = (rows, name, artist) => {
  if (!rows || !rows.length) return null;
  const wantT = normSearch(name);
  const wantA = normSearch(artist);
  if (!wantT) return rows[0]?.image || "";
  let best = rows[0]?.image || "";
  let bestScore = -1;
  for (const r of rows) {
    const t = normSearch(r.name);
    const a = normSearch(rowArtists(r));
    let score = t === wantT ? 30 : t.includes(wantT) || wantT.includes(t) ? 12 : 0;
    if (wantA && a) {
      score += a === wantA ? 8 : a.includes(wantA) || wantA.includes(a) ? 3 : 0;
    }
    if (score > bestScore) {
      bestScore = score;
      best = r?.image || "";
    }
  }
  return best;
};

const saavnImageFor = async (type, item) => {
  const name = item.name || "";
  const artist = rowArtists(item);
  const query = `${name} ${artist}`.trim() || name;
  let data;
  try {
    if (type === "track") data = await saavnService.searchTracks(query, { page: 1, limit: 8 });
    else if (type === "album") data = await saavnService.searchAlbums(query, { page: 1, limit: 8 });
    else if (type === "artist") data = await saavnService.searchArtists(name, { page: 1, limit: 8 });
    else if (type === "playlist") data = await saavnService.searchPlaylists(name, { page: 1, limit: 8 });
    else return "";
  } catch {
    return "";
  }
  return String(bestImageMatch(data?.results, name, artist) || "").trim();
};

const fillMissingImages = async (type, items) => {
  const tasks = [];
  const seen = new Set();
  items.forEach((item, idx) => {
    if (!item || String(item.image || "").trim()) return;
    const k = String(KEYS[type](item) || "");
    if (!k || seen.has(k)) return;
    seen.add(k);
    tasks.push({ idx, item, k });
  });
  if (!tasks.length) return items;
  const filled = await mapLimit(tasks, 5, async ({ idx, item, k }) => ({
    idx,
    image: await memoize(makeCacheKey("img:fill", { type, k }), IMAGE_FILL_TTL, () => saavnImageFor(type, item)),
  }));
  const next = items.slice();
  for (const { idx, image } of filled) {
    if (image && next[idx]) next[idx] = { ...next[idx], image };
  }
  return next;
};

// Spotify and Amazon rows carry no audio (or only a 16s Spotify preview), so
// they wouldn't play. Replaces that audio with a full-length copy (Saavn).
// Already playable rows are untouched, so Saavn results cost nothing.
// opts.saavnOnly skips the resolver entirely: the search page resolves MANY rows
// at once, and a full resolve for every unmatched track is both slow and heavy
// on a small instance. Detail/play endpoints keep the full resolve by default.
const makePlayable = async (track, opts = {}) => {
  if (!track) return track;
  // Skip already-resolved tracks (Spotify/Amazon resolve audio in their own
  // search methods; Saavn tracks always have full CDN audio). Only unresolved
  // tracks need the Saavn/YT fallback here.
  if (track.audio && !isPreviewAudioUrl(track.audio)) return track;
  const resolver = opts.saavnOnly ? resolveSaavnOnly : resolvePlayableAudio;
  const { audioUrl, duration, videoId } = await resolver({
    name: track.name,
    artist: track.artist_name,
    audioUrl: track.audio,
    duration: track.duration,
    source: track.source,
    id: track.id,
  });
  if (track.audio === audioUrl && track.duration === duration) return track;
  return { ...track, audio: audioUrl, duration, ...(videoId ? { videoId } : {}) };
};

// Ensures every returned track (and every song inside album/playlist rows)
// actually has playable audio. Bounded to 5 in-flight resolutions so a big
// result set can't fan out against the resolvers all at once.
const enrichPlayable = async (items, type, opts = {}) => {
  if (!items || !items.length) return items || [];

  if (type === "track") {
    return mapLimit(items, 5, (t) => makePlayable(t, opts));
  }

  const tasks = [];
  items.forEach((item, idx) => {
    if (item && Array.isArray(item.songs) && item.songs.length) {
      item.songs.forEach((song, j) => tasks.push({ idx, j, song }));
    }
  });
  if (!tasks.length) return items;

  const updated = await mapLimit(tasks, 5, async ({ idx, j, song }) => ({
    idx,
    j,
    song: await makePlayable(song, opts),
  }));
  const next = items.map((item) =>
    item && Array.isArray(item.songs) && item.songs.length
      ? { ...item, songs: item.songs.slice() }
      : item
  );
  for (const { idx, j, song } of updated) next[idx].songs[j] = song;
  return next;
};

// Enriches rows with playable audio + missing artwork in one combined pass.
// Used for the merged results list.
const enrichRows = async (type, rows, opts = {}) => {
  if (!rows || !rows.length) return rows || [];
  const [playable, imaged] = await Promise.all([
    enrichPlayable(rows, type, opts),
    fillMissingImages(type, rows),
  ]);
  return imaged.map((row, i) => {
    const p = playable[i];
    if (!p || p === row || !p.audio) return row;
    return { ...row, audio: p.audio, duration: p.duration || row.duration };
  });
};

const searchByType = async ({ query, type, limit, page, offset }) => {
  const fetchers = [];

  // Each provider fetcher returns { source, rows } keyed by provider name so
  // downstream code can map rows back to their source even after a
  // per-provider timeout drops one out of the page.
  const keyed = (source, rowsPromise) =>
    bounded(async () => ({ source, rows: await rowsPromise }), PROVIDER_TIMEOUTS[source] || 15000);

  if (type === "track") {
    fetchers.push(keyed("saavn", saavnService.searchTracks(query, { page, limit }).then((d) => d && d.results)));
  } else if (type === "album") {
    fetchers.push(keyed("saavn", saavnService.searchAlbums(query, { page, limit }).then((d) => d && d.results)));
  } else if (type === "artist") {
    fetchers.push(keyed("saavn", saavnService.searchArtists(query, { page, limit }).then((d) => d && d.results)));
  } else if (type === "playlist") {
    fetchers.push(keyed("saavn", saavnService.searchPlaylists(query, { page, limit }).then((d) => d && d.results)));
  }

  // Amazon rows come from the unofficial music.amazon.* scraper (real
  // catalog, no LWA/cookies). The resolver fills playable audio below.
  fetchers.push(
    keyed("spotify", spotifyService.search(query, { type, limit, offset, resolveAudio: false }).then((d) => d && d.results && d.results[type])),
    keyed("amazon", amazonWebService.search(query, { type, limit, page, resolveAudio: false }).then((d) => d && d.results && d.results[type]))
  );

  // YouTube Music track rows come from innertube (no yt-dlp/cookies/proxy)
  // and carry a `videoId` the browser embeds client-side. Only tracks use it:
  // albums/artists/playlists stay Saavn+Spotify+Amazon.
  if (type === "track") {
    fetchers.push(
      keyed("ytmusic", ytmusicService.searchTracks(query, { limit, offset }).then((d) => d && d.results && d.results.track))
    );
  }

  // Wait for every provider (each bounded by its own budget) so the page
  // represents all upstream APIs, then make the merged rows playable in one pass.
  // Providers are fetched raw (resolveAudio:false) so a slow provider can't
  // drop out of the page, and resolution is deferred to here instead: only
  // rows that lack full-length audio (raw Spotify previews, Amazon rows) go
  // through the resolver — Saavn CDN rows cost nothing.
  const settled = await Promise.allSettled(fetchers);
  const providers = settled
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value)
    .filter(Boolean);

  // ── track type: return both the merged list AND per-provider lists ─────
  // Tracks are displayed grouped by source on the results page. The merged
  // list is enriched with playable audio (the resolver reuses just-warmed
  // provider caches). Per-provider lists get only artwork fills (cheap,
  // memoized) so a cold upstream can't bloat search latency — rows without
  // full audio fall back to /tracks/resolve at play time.
  //
  // Spotify, Amazon and YouTube are OPTIONAL sources. When one is down,
  // throttled, or returns nothing, its group falls back to the reliable Saavn
  // catalog (which is already warm here — no extra upstream call): the page
  // never shows an empty source tab, and every row stays real (source label
  // preserved) and playable via Saavn CDN. Rows carry a
  // `fallbackOf` marker so the UI can flag "shown from Saavn".
  if (type === "track") {
    const bySource = { saavn: [], spotify: [], amazon: [], ytmusic: [] };
    for (const p of providers) {
      if (p.rows) bySource[p.source] = tag(p.rows, p.source);
    }

    const saavnRows = bySource.saavn;
    if (saavnRows.length) {
      for (const src of ["spotify", "amazon", "ytmusic"]) {
        if (!bySource[src].length) {
          bySource[src] = saavnRows.map((row) => ({ ...row, fallbackOf: src }));
        }
      }
    }

    const merged = merge(
      [bySource.saavn, bySource.spotify, bySource.ytmusic, bySource.amazon],
      KEYS.track,
      limit
    );

    // A page resolves MANY rows at once; full audio still lands on the merged
    // page via the economical Saavn CDN, and the ~20% Saavn can't match defer
    // to /tracks/resolve when the user actually taps play.
    //
    // The whole enrichment runs under ONE shared clock: the merged list gets
    // first claim, the source-list pass keeps whatever remains. On timeout we
    // return the raw merged rows rather than stalling the page behind a slow
    // upstream.
    const clock = makeEnrichClock();

    const enrichedMerged =
      (await withDeadline(clock.left() || 2500, enrichRows(type, merged, { saavnOnly: true }))) || merged;

    // The merged list's enrichment already resolved full audio (Saavn) for the
    // tracks above. Stamp that work onto the
    // matching per-provider rows too — zero extra upstream calls — so a tap on
    // any source tab that also appeared on the merged page plays IMMEDIATELY
    // instead of a separate /tracks/resolve round-trip (which is slow on a
    // cold cache and reads as "the song won't play"). Rows the merged list
    // didn't cover are resolved in a bounded pass just below so every source
    // tab row still plays immediately.
    const audioByKey = new Map();
    for (const t of enrichedMerged) {
      const k = String(trackKey(t) || "");
      if (k && t.audio) audioByKey.set(k, { audio: t.audio, duration: t.duration });
    }
    const stampFromMerged = (rows) =>
      (rows || []).map((row) => {
        if (!row || !row.name || (row.audio && !isPreviewAudioUrl(row.audio))) return row;
        const hit = audioByKey.get(String(trackKey(row) || ""));
        if (!hit || !hit.audio) return row;
        return { ...row, audio: hit.audio, duration: hit.duration || row.duration };
      });
    for (const src of ["spotify", "amazon", "ytmusic"]) {
      bySource[src] = stampFromMerged(bySource[src]);
    }

    // Source-tab rows that didn't make the merged page (limit cutoff) may
    // still lack full-length audio — raw Spotify previews and Amazon rows have
    // none by design. Resolve those too (Saavn-only, bounded by whatever is
    // left on the shared clock) so every tab row plays immediately where
    // possible; unresolved rows fall back to /tracks/resolve at play time.
    // Rows the merged pass already enriched short-circuit in makePlayable
    // (full audio), and the Saavn searches behind them are warm from that pass,
    // so a hit page costs almost nothing extra.
    const listMinimumMs = 1500;
    const perListBudget = Math.max(clock.left(), listMinimumMs * 3) / 3;
    const resolveListAudio = async (rows, budgetMs) => {
      if (!rows || !rows.length) return rows || [];
      if (!rows.some((r) => !r || !r.audio || isPreviewAudioUrl(r.audio))) return rows;
      const budget = Math.max(budgetMs, listMinimumMs);
      const updated = await withDeadline(budget, mapLimit(rows, 5, (t) => makePlayable(t, { saavnOnly: true })));
      return updated || rows;
    };

    const audioResolved = await Promise.all([
      resolveListAudio(bySource.spotify, perListBudget),
      resolveListAudio(bySource.amazon, perListBudget),
      resolveListAudio(bySource.ytmusic, perListBudget),
    ]);
    bySource.spotify = audioResolved[0];
    bySource.amazon = audioResolved[1];
    bySource.ytmusic = audioResolved[2];

    // Per-provider artwork fills (memoized 24 h), two arrays at a time so a
    // slow image lookup can't cascade across providers.
    const filled = await mapLimit(
      [bySource.saavn, bySource.spotify, bySource.ytmusic, bySource.amazon],
      2,
      (rows) => fillMissingImages(type, rows)
    );
    const tracksBySource = {
      saavn: filled[0],
      spotify: filled[1],
      ytmusic: filled[2],
      amazon: filled[3],
    };

    return { merged: enrichedMerged, tracksBySource };
  }

  // ── non-track types: single merged stream ─────────────────────────────
  // Rows are tagged with their provider so the UI can route albums/playlists
  // to the right detail endpoint (?source=...) instead of guessing Saavn.
  // Enrichment is Saavn-only and bounded by the same total-budget clock used
  // for the track branch.
  const arrays = providers.map((p) => tag(p.rows, p.source));
  const raw = merge(arrays, KEYS[type], limit);
  const clock = makeEnrichClock();
  const merged =
    (await withDeadline(Math.max(clock.left(), 2500), enrichRows(type, raw, { saavnOnly: true }))) || raw;
  return { merged, tracksBySource: null };
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
        const { merged, tracksBySource } = await searchByType({ query, type, limit, page, offset });
        results[type] = merged;
        if (type === "track" && tracksBySource) results.tracksBySource = tracksBySource;
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
    if (results.tracksBySource) payload.tracksBySource = results.tracksBySource;

    return { total, results: payload };
  });
};

module.exports = { search, resolveTypes, makePlayable, enrichPlayable };