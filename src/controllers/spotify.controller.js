const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const { logger } = require("../services/logger.service");
const { getCache, setCache, makeCacheKey } = require("../services/cache.service");
const spotifyService = require("../services/spotify.service");
const saavnService = require("../services/saavn.service");
const mapLimit = require("../utils/mapLimit");
// Full-length audio pipeline shared with the unified search and the Amazon
// endpoints: Saavn CDN first, YouTube Music stream as the backstop.
const { enrichPlayable } = require("../services/search.service");

// JioSaavn exposes real artwork + playable audio, which Spotify's open proxy
// does not (Spotify tracks come back with name/audio preview but no image).
// To show each song with its own cover, match by name (optionally + artist) and
// fill the missing image/audio/duration from the best JioSaavn result.
const SEARCH_CAP = 60;
const SEARCH_CONCURRENCY = 5;
// Enrichment issues up to SEARCH_CAP Saavn lookups per playlist; cache the
// enriched output so repeat fetches of the same playlist return instantly
// without re-running the Saavn matching.
const ENRICH_TTL = 600;

// Same-track Saavn lookups within one enrichment batch share one upstream call
// (two "favorite" tracks with identical title/artist would otherwise each fire
// a separate search). Bounded, short-TTL, in-process memo.
const enrichMemo = new Map();
const ENRICH_MEMO_TTL_MS = 300 * 1000;
const ENRICH_MEMO_MAX = 200;

const memoEnrichFromSaavn = async (track) => {
  const key = `${normalizeName(track.name)}|${normalizeName(track.artist_name)}`;
  const hit = enrichMemo.get(key);
  if (hit && Date.now() - hit.t < ENRICH_MEMO_TTL_MS) return hit.value;
  const value = await enrichFromSaavn(track);
  if (enrichMemo.size >= ENRICH_MEMO_MAX) enrichMemo.clear();
  enrichMemo.set(key, { value, t: Date.now() });
  return value;
};

const normalizeName = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const enrichFromSaavn = async (track) => {
  try {
    const q = [track.name, track.artist_name].filter(Boolean).join(" ");
    const data = await saavnService.searchTracks(q, { limit: 5, page: 1 });
    const results = data?.results || [];
    if (!results.length) return null;

    const queryName = normalizeName(track.name);
    const queryArtist = normalizeName(track.artist_name);
    const sortKey = (r) => {
      let score = 0;
      if (normalizeName(r.name) === queryName) score += 100;
      if (r.artist_name && normalizeName(r.artist_name) === queryArtist) score += 20;
      return score;
    };
    const best = [...results].sort((a, b) => sortKey(b) - sortKey(a))[0];
    if (sortKey(best) === 0) return null;

    return {
      id: track.id,
      name: track.name,
      type: track.type || "track",
      source: "spotify",
      artist_name: best.artist_name || track.artist_name,
      album_name: best.album_name || "",
      album_id: best.album_id || "",
      image: best.image || track.image || "",
      audio: best.audio || track.audio || "",
      duration: best.duration || track.duration || 0,
      year: best.year || "",
      play_count: best.play_count || 0,
      language: best.language || "",
      label: best.label || "",
      url: track.url || "",
      has_lyrics: best.has_lyrics || false,
      copyright: best.copyright || "",
      artists: best.artists || track.artists || {},
    };
  } catch (err) {
    logger.warn({ err: { message: err.message }, name: track.name }, "enrichFromSaavn failed");
    return null;
  }
};

const enrichSpotifyTracks = async (songs) => {
  const targets = songs.filter((t) => !t.image).slice(0, SEARCH_CAP);

  const enriched = await mapLimit(targets, SEARCH_CONCURRENCY, async (t) => {
    const rich = await memoEnrichFromSaavn(t);
    return rich || t;
  });

  // Preserve the original order for every track, swapping in enriched data.
  const byId = new Map(enriched.map((t) => [String(t.id), t]));
  return songs.map((t) => byId.get(String(t.id)) || t);
};

const search = asyncHandler(async (req, res) => {
  const { q, type, limit, offset } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);
  const data = await spotifyService.search(q, { type, limit, offset });
  return ApiResponse.success(res, data.results || [], `Found ${data.total} results`);
});

const getTrackById = asyncHandler(async (req, res) => {
  const track = await spotifyService.getTrackById(req.params.id);
  if (!track) return ApiResponse.error(res, "Track not found", 404);
  return ApiResponse.success(res, track);
});

// Returns a playable, full-length audio URL for a Spotify track. Spotify only
// provides 30s previews, so the track is auto-matched to a full Saavn CDN
// copy (see trackResolver). Response includes `is_full_audio` so clients can
// tell a real stream from a preview fallback.
const getTrackStream = asyncHandler(async (req, res) => {
  const stream = await spotifyService.getTrackStream(req.params.id);
  if (!stream) return ApiResponse.error(res, "Track not found", 404);
  return ApiResponse.success(res, stream);
});

const getAlbumById = asyncHandler(async (req, res) => {
  const album = await spotifyService.getAlbumById(req.params.id);
  if (!album) return ApiResponse.error(res, "Album not found", 404);
  return ApiResponse.success(res, album);
});

const getAlbumTracks = asyncHandler(async (req, res) => {
  const album = await spotifyService.getAlbumById(req.params.id);
  if (!album) return ApiResponse.error(res, "Album not found", 404);

  const cacheKey = makeCacheKey("spotify:album:tracks", { id: req.params.id });
  const cached = getCache(cacheKey);
  if (cached) return ApiResponse.success(res, cached);

  // Spotify songs ship as 30s previews; replace them with a full-length copy
  // (Saavn CDN, YouTube Music backstop) so album songs stream end to end.
  const songs = await enrichPlayable(album.songs || [], "track");
  setCache(cacheKey, songs, ENRICH_TTL);
  return ApiResponse.success(res, songs);
});

const getArtistById = asyncHandler(async (req, res) => {
  const artist = await spotifyService.getArtistById(req.params.id);
  if (!artist) return ApiResponse.error(res, "Artist not found", 404);
  return ApiResponse.success(res, artist);
});

const getArtistTopTracks = asyncHandler(async (req, res) => {
  const { market } = req.query;
  const data = await spotifyService.getArtistTopTracks(req.params.id, { market });
  return ApiResponse.success(res, data?.results || []);
});

const getArtistAlbums = asyncHandler(async (req, res) => {
  const { type, limit, offset } = req.query;
  const data = await spotifyService.getArtistAlbums(req.params.id, {
    type,
    limit,
    offset,
  });
  return ApiResponse.success(res, data?.results || []);
});

const getPlaylistById = asyncHandler(async (req, res) => {
  const playlist = await spotifyService.getPlaylistById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);
  return ApiResponse.success(res, playlist);
});

const getPlaylistTracks = asyncHandler(async (req, res) => {
  const playlist = await spotifyService.getPlaylistById(req.params.id);
  if (!playlist) return ApiResponse.error(res, "Playlist not found", 404);

  // Cache the enriched (Saavn-merged) track list per playlist id. The Spotify
  // source data is already cached by the service; this layer skips the repeated
  // Saavn matching on subsequent requests.
  const cacheKey = makeCacheKey("spotify:playlist:tracks", { id: req.params.id });
  const cached = getCache(cacheKey);
  if (cached) return ApiResponse.success(res, cached);

  // Spotify songs ship as 30s previews. The Saavn merge below fills
  // image + audio for image-less songs; tracks that already carry an image
  // keep their preview, so a second enrichPlayable pass resolves any
  // remaining preview/empty audio (Saavn CDN, YouTube Music backstop).
  const songs = await enrichPlayable(await enrichSpotifyTracks(playlist.songs || []), "track");
  setCache(cacheKey, songs, ENRICH_TTL);
  return ApiResponse.success(res, songs);
});

const getHealth = asyncHandler(async (req, res) => {
  const data = await spotifyService.getHealth();
  return ApiResponse.success(res, data);
});

const getToken = asyncHandler(async (req, res) => {
  const data = await spotifyService.getToken();
  return ApiResponse.success(res, data);
});

module.exports = {
  search,
  getTrackById,
  getTrackStream,
  getAlbumById,
  getAlbumTracks,
  getArtistById,
  getArtistTopTracks,
  getArtistAlbums,
  getPlaylistById,
  getPlaylistTracks,
  getHealth,
  getToken,
};