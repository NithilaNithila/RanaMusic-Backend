const saavnService = require("./saavn.service");
const ytService = require("./ytmusic.service");

// Spotify preview clips are short MP3s hosted on p.scdn.co; amazon tracks
// arrive with no audio at all. Any of these can't play a full song, so we mark
// the stored url as "needs full resolution".
const PREVIEW_PATTERNS = [/p\.scdn\.co/, /mp3-preview|preview/i, /msecnd\.net/i];

const isPreviewAudioUrl = (url) => {
  if (typeof url !== "string" || !url.trim()) return true;
  if (url.startsWith("/api/ytmusic/")) return false; // YT stream URL — already playable
  if (url.startsWith("/api/")) return true; // other backend proxy paths — try Saavn first
  return PREVIEW_PATTERNS.some((re) => re.test(url));
};

const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Normalizes a title WITHOUT collapsing parentheticals/brackets so version
// info ("Rathinamo (Female Version)" vs "Rathinamo") is preserved for exact
// matching. The base form is still used for fuzzy fallback.
const normalizeFull = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Splits an artist string into individual artist tokens, handling the common
// separator styles providers (Spotify/Amazon) use: commas, "feat.", "ft.",
// "&", "and", "duet", "with". "Saurav Srisan feat. Tanisha Gnanavel"
// becomes ["saurav srisan", "tanisha gnanavel"] instead of one giant token.
const splitArtists = (s) =>
  String(s || "")
    .split(/\s*,|\s+feat(?:uring)?\.?|\s+ft\.?|\s+&\s*|\s+and\s+|\s+duet\s+|\s+with\s+/i)
    .map((n) => n.trim())
    .filter(Boolean);

const parseArtists = (s) => splitArtists(s).map((n) => n.toLowerCase());

// Finds a full, playable (Saavn) version of a track by name + artist.
// Returns null when nothing matches well enough to risk a wrong track.
const findFullTrack = async ({ name, artist = "" }) => {
  const cleanName = String(name || "")
    .replace(/\([^)]*\)\s*/g, " ")
    .replace(/\[[^\]]*\]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Keep the versioned title + primary artist so sibling versions resolve to
  // their own copy; strip only the feat. tail so Saavn indexes the right song.
  const query = [cleanName, splitArtists(artist)[0]]
    .filter(Boolean)
    .join(" ")
    .trim()
    .slice(0, 120);
  if (!query) return null;

  const data = await saavnService.searchTracks(query, { page: 1, limit: 20 });
  const results = data.results || [];

  const qName = normalize(name);
  const qNameFull = normalizeFull(name);
  const qArtists = parseArtists(artist);

  let best = null;
  let bestScore = 0;

  for (const t of results) {
    if (!t || !t.audio) continue;
    const tName = normalize(t.name);
    const tNameFull = normalizeFull(t.name);
    const tArtists = parseArtists(t.artist_name);

    let score = 0;
    // Exact full title (keeps "Female Version") is the strongest signal and
    // keeps sibling versions from being conflated into one track.
    if (tNameFull === qNameFull) score += 60;
    else if (tName === qName) score += 40;
    else if (tName.includes(qName) || qName.includes(tName)) score += 20;

    if (qArtists.length && tArtists.length) {
      const hits = qArtists.filter((a) =>
        tArtists.some((ta) => ta.includes(a) || a.includes(ta))
      ).length;
      score += Math.min(hits, 3) * 10;
    }

    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }

  return bestScore >= 20 ? best : null;
};

// How many YouTube hits to consider for the backstop. `ytsearch1` is not
// enough: a versioned request ("... Female Version") often ranks its base
// version first, so the single top hit gets rejected and the track is left
// unplayable even though the right version is one result down.
const YT_BACKSTOP_LIMIT = 5;

// YouTube Music backstop, used ONLY when Saavn finds no strong match. Keeps
// the ~20% of tracks Saavn can't cover playable via an in-process yt-dlp
// stream. Several hits are scored so the best title/artist match wins, and the
// title must still line up (substring both ways, or every requested base token
// present) so a bot's "best guess" can't feed the wrong track into the player.
const findYtFullTrack = async ({ name, artist = "" }) => {
  if (!ytService.isEnabled() || ytService.isBreakerOpen()) return null;
  const cleanName = String(name || "")
    .replace(/\([^)]*\)\s*/g, " ")
    .replace(/\[[^\]]*\]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const query = [cleanName, splitArtists(artist)[0]]
    .filter(Boolean)
    .join(" ")
    .trim()
    .slice(0, 120);
  if (!query) return null;

  let rows = [];
  try {
    const data = await ytService.search(query, { type: "track", limit: YT_BACKSTOP_LIMIT });
    rows = (data && data.results && data.results.track) || [];
  } catch (err) {
    return null;
  }

  const wantFull = normalizeFull(name);
  const wantBase = normalize(name);
  const wantTokens = wantFull.split(" ").filter(Boolean);
  const wantBaseTokens = wantBase.split(" ").filter(Boolean);
  const wantArtists = splitArtists(artist).map((a) => a.toLowerCase()).filter(Boolean);

  let best = null;
  let bestScore = 0;
  for (const row of rows) {
    if (!row || !row.audio || !row.name) continue;
    const gotFull = normalizeFull(row.name);
    if (!gotFull) continue;
    // The primary title token must appear in the candidate so an unrelated hit
    // can never win.
    if (wantTokens[0] && !gotFull.includes(wantTokens[0])) continue;

    const gotTokens = new Set(gotFull.split(" ").filter(Boolean));
    let score = gotFull === wantFull ? 100 : 0;
    // Token overlap on the FULL title (parentheticals preserved) keeps sibling
    // versions apart: a "female version" request must match "female version".
    score += wantTokens.filter((t) => gotTokens.has(t)).length * 10;
    const gotArtist = String(row.artist_name || "").toLowerCase();
    if (wantArtists.some((a) => a && (gotArtist.includes(a) || a.includes(gotArtist)))) {
      score += 20;
    }

    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  if (!best || bestScore < 20) return null;

  // Final safety net: the candidate's base title must line up with the
  // requested base title so a version-word coincidence can't pick a wrong song.
  const gotBase = normalize(best.name);
  const baseOk =
    !!gotBase &&
    (gotBase.includes(wantBase) ||
      wantBase.includes(gotBase) ||
      (wantBaseTokens.length > 0 && wantBaseTokens.every((t) => gotBase.includes(t))));
  if (!baseOk) return null;

  return {
    audioUrl: best.audio,
    duration: Number(best.duration) || 0,
    image: best.image || "",
    name: best.name,
  };
};

// Bounded promise: resolves with the value or `fallback` after `ms`
// milliseconds so a slow upstream can't hold the whole resolve chain hostage.
// The timer is cleared when the underlying promise settles first, so an early
// win can't leave a latent timeout later firing a pointless `resolve` on an
// already-settled promise.
const withTimeout = (promise, ms, fallback = null) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    if (typeof timer.unref === "function") timer.unref();
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });

// Total wall-clock budget for the Saavn resolve chain. Saavn's free-tier host
// can be slow, so cap the resolve so the stored preview (or nothing) wins
// rather than paying an unbounded tail. Must land under the client's own
// timeout (the app waits 15s for /api/tracks/resolve).
const RESOLVE_DEADLINE_MS = 13000;
// Inner budgets: Saavn gets most of the time budget; the YouTube backstop is
// bounded so a throttled datacenter IP can't dominate the resolve chain. The
// two are sequential, so worst case ≈ 7s + 7s ≈ 14s > 13s total cap — the
// outer deadline is the final authority.
const SAVN_RESOLVE_DEADLINE_MS = 7000;
const YT_RESOLVE_DEADLINE_MS = 7000;

// Replaces a stored preview / missing audio url with a full-length playable
// copy. Saavn CDN is tried first (reliable, zero YouTube traffic); the
// in-process YouTube stream backstop covers only the tracks Saavn can't match.
// Best-effort: on failure the original values are preserved.
const resolvePlayableAudioRaw = async ({ name, artist = "", audioUrl = "", duration = 0 }) => {
  if (!isPreviewAudioUrl(audioUrl)) return { audioUrl, duration };

  let full = null;
  try {
    full = await withTimeout(findFullTrack({ name, artist }), SAVN_RESOLVE_DEADLINE_MS);
  } catch (err) {
    // Resolution is best-effort; keep the original audio on failure.
  }

  if (full && full.audio) {
    return { audioUrl: full.audio, duration: full.duration || duration, image: full.image || "" };
  }

  try {
    const ytHit = await withTimeout(findYtFullTrack({ name, artist }), YT_RESOLVE_DEADLINE_MS);
    if (ytHit && ytHit.audioUrl) {
      return {
        audioUrl: ytHit.audioUrl,
        duration: ytHit.duration || duration,
        image: ytHit.image || "",
      };
    }
  } catch (err) {
    // Best-effort: preserve the original audio on any search/breaker failure.
  }

  return { audioUrl, duration };
};

// Guaranteed upper bound on the whole chain: the deadline above can still be
// exceeded if the Saavn search hangs past its own budget, so race the entire
// resolve against a single clock and fall back to the original values.
const resolvePlayableAudio = (opts) =>
  withTimeout(resolvePlayableAudioRaw(opts), RESOLVE_DEADLINE_MS, {
    audioUrl: opts.audioUrl,
    duration: opts.duration,
  });

module.exports = {
  isPreviewAudioUrl,
  parseArtists,
  findFullTrack,
  findYtFullTrack,
  withTimeout,
  resolvePlayableAudio,
};