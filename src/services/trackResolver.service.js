const saavnService = require("./saavn.service");
const ytmusicSearchService = require("./ytmusicSearch.service");

// Spotify preview clips are short MP3s hosted on p.scdn.co; amazon tracks
// arrive with no audio at all. Any of these can't play a full song, so we mark
// the stored url as "needs full resolution".
const PREVIEW_PATTERNS = [/p\.scdn\.co/, /mp3-preview|preview/i, /msecnd\.net/i];

const isPreviewAudioUrl = (url) => {
  if (typeof url !== "string" || !url.trim()) return true;
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
// Inner budget: Saavn gets most of the time budget so a slow free-tier host
// can't dominate the resolve chain.
const SAVN_RESOLVE_DEADLINE_MS = 7000;
// Inner budget for the YouTube last-resort lookup. Cheap (single innertube
// POST), but only runs after Saavn fails, so keep it small.
const YT_FALLBACK_DEADLINE_MS = 5000;

// Last-resort: when Saavn has no strong match, find the track on YouTube Music
// via innertube (no yt-dlp/cookies/proxy) and hand back the videoId. The
// browser embeds it client-side, so no backend stream is needed.
const findYtFallback = async ({ name, artist = "" }) => {
  const cleanName = String(name || "")
    .replace(/\([^)]*\)\s*/g, " ")
    .replace(/\[[^\]]*\]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Keep the primary artist so sibling versions resolve to their own copy.
  const query = [cleanName, splitArtists(artist)[0]]
    .filter(Boolean)
    .join(" ")
    .trim()
    .slice(0, 120);
  if (!query) return null;
  try {
    const hit = await ytmusicSearchService.findTrack(query);
    if (!hit || !hit.videoId) return null;
    return { videoId: hit.videoId, image: hit.image || "" };
  } catch {
    return null;
  }
};

// Replaces a stored preview / missing audio url with a full-length playable
// copy from the Saavn CDN. Best-effort: on failure the original values are
// preserved. When Saavn can't match, falls back to a YouTube Music videoId so
// the client can embed the track instead of erroring out.
const resolvePlayableAudioRaw = async ({ name, artist = "", audioUrl = "", duration = 0, source = "", id = "" }) => {
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

  // No Saavn copy → hand back a YouTube Music videoId (dedupe: a ytmusic row
  // already carries its videoId in `id`; skip a redundant lookup for it).
  if (source === "ytmusic" && id) {
    return { audioUrl, duration, videoId: String(id), image: "" };
  }
  try {
    const yt = await withTimeout(findYtFallback({ name, artist }), YT_FALLBACK_DEADLINE_MS);
    if (yt && yt.videoId) {
      return { audioUrl, duration, videoId: yt.videoId, image: yt.image || "" };
    }
  } catch (err) {
    // Best-effort: a failed YouTube lookup keeps the original audio values.
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
    videoId: opts.videoId || "",
  });

// Cheaper, bounded lookups for calls where MANY rows are resolved at once —
// used by the search page. Best-effort: missing/unchanged audio is preserved,
// so rows fall back to /tracks/resolve at play time.
const RESOLVE_SAVN_ONLY_DEADLINE_MS = 6000;
const resolveSaavnOnly = (opts) =>
  withTimeout(
    (async () => {
      if (!isPreviewAudioUrl(opts.audioUrl)) return { audioUrl: opts.audioUrl, duration: opts.duration };
      try {
        const full = await withTimeout(findFullTrack({ name: opts.name, artist: opts.artist }), 5000);
        if (full && full.audio) {
          return { audioUrl: full.audio, duration: full.duration || opts.duration, image: full.image || "" };
        }
      } catch (err) {
        // Best-effort: preserve the original audio on any search failure.
      }
      return { audioUrl: opts.audioUrl, duration: opts.duration };
    })(),
    RESOLVE_SAVN_ONLY_DEADLINE_MS,
    { audioUrl: opts.audioUrl, duration: opts.duration }
  );

module.exports = {
  isPreviewAudioUrl,
  parseArtists,
  findFullTrack,
  findYtFallback,
  withTimeout,
  resolvePlayableAudio,
  resolveSaavnOnly,
};