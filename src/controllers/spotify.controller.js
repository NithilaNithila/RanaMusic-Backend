const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const { logger } = require("../services/logger.service");
const { getCache, setCache, makeCacheKey } = require("../services/cache.service");
const spotifyService = require("../services/spotify.service");
const saavnService = require("../services/saavn.service");

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

  const enriched = [];
  for (let i = 0; i < targets.length; i += SEARCH_CONCURRENCY) {
    const batch = targets.slice(i, i + SEARCH_CONCURRENCY);
    const settled = await Promise.all(
      batch.map((t) => enrichFromSaavn(t).then((r) => ({ orig: t, rich: r })))
    );
    for (const { orig, rich } of settled) enriched.push(rich || orig);
  }

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

const getAlbumById = asyncHandler(async (req, res) => {
  const album = await spotifyService.getAlbumById(req.params.id);
  if (!album) return ApiResponse.error(res, "Album not found", 404);
  return ApiResponse.success(res, album);
});

const getAlbumTracks = asyncHandler(async (req, res) => {
  const album = await spotifyService.getAlbumById(req.params.id);
  if (!album) return ApiResponse.error(res, "Album not found", 404);
  return ApiResponse.success(res, album.songs || []);
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

  const songs = await enrichSpotifyTracks(playlist.songs || []);
  setCache(cacheKey, songs, ENRICH_TTL);
  return ApiResponse.success(res, songs);
});

module.exports = {
  search,
  getTrackById,
  getAlbumById,
  getAlbumTracks,
  getArtistById,
  getArtistTopTracks,
  getArtistAlbums,
  getPlaylistById,
  getPlaylistTracks,
};