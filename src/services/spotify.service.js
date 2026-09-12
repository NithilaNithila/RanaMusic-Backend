const axios = require("axios");
const spotifyConfig = require("../config/spotify");
const { httpAgent, httpsAgent } = require("../config/http");
const { getCache, setCache, makeCacheKey } = require("./cache.service");
const { retry } = require("../utils/retry");
const {
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
} = require("./spotify.mappers");
const { resolvePlayableAudio, isPreviewAudioUrl } = require("./trackResolver.service");
const mapLimit = require("../utils/mapLimit");

const client = axios.create({
  baseURL: spotifyConfig.baseURL,
  timeout: 6000,
  httpAgent,
  httpsAgent,
});

const clampLimit = (limit) => Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
const clampOffset = (offset) => Math.max(parseInt(offset, 10) || 0, 0);

class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

const isNotFound = (err) =>
  err instanceof UpstreamError && (err.status === 404 || err.status === 400);

const wxfGet = async (path, params = {}) => {
  const cacheKey = makeCacheKey(`wolfx:${path}`, params);
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const data = await retry(
    async () => {
      try {
        const res = await client.get(path, { params });
        return res.data;
      } catch (err) {
        if (err.response) {
          throw new UpstreamError(
            err.response.data?.error || `wolfXspotify ${err.response.status} on ${path}`,
            err.response.status
          );
        }
        throw new UpstreamError(`wolfXspotify unreachable on ${path}`);
      }
    },
    {
      retries: 2,
      baseMs: 400,
      maxTotalMs: 12000,
      shouldRetry: (err) => !(err instanceof UpstreamError && err.status < 500 && err.status !== 429),
    }
  );

  if (!data || data.success === false) {
    throw new UpstreamError(data?.error || `wolfXspotify error on ${path}`);
  }

  setCache(cacheKey, data);
  return data;
};

// Resolves full-length audio for an array of tracks by matching each one
// against Saavn. Bounded to 5 in-flight resolutions so large result sets don't
// fan out all at once.
const resolveTracksAudio = async (tracks) => {
  if (!tracks || !tracks.length) return tracks || [];
  return mapLimit(tracks, 5, async (track) => {
    if (!track || !isPreviewAudioUrl(track.audio)) return track;
    try {
      const resolved = await resolvePlayableAudio({
        name: track.name,
        artist: track.artist_name,
        audioUrl: track.audio,
        duration: track.duration,
        source: "spotify",
        id: track.id,
      });
      if (resolved.audioUrl !== track.audio) {
        return { ...track, audio: resolved.audioUrl, duration: resolved.duration || track.duration };
      }
    } catch (_) {}
    return track;
  });
};

const SEARCH_TYPES = ["track", "album", "artist", "playlist"];

const resolveSearchTypes = (type) => {
  if (type === "all") return SEARCH_TYPES;
  const requested = String(type || "track")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => SEARCH_TYPES.includes(t));
  return requested.length ? requested : ["track"];
};

const search = async (query, opts = {}) => {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  const types = resolveSearchTypes(opts.type);
  // The unified multi-provider search defers audio resolution to play-time
  // (see search.service) — resolving every row here is O(rows) upstream calls
  // and stalls the whole page. Opt out with resolveAudio:false.
  const resolveAudio = opts.resolveAudio !== false;

  const results = {};
  let total = 0;

  await Promise.allSettled(
    types.map(async (type) => {
      const data = await wxfGet("/search", { q: query, type, limit, offset });
      const items = data.results || [];
      switch (type) {
        case "track": {
          const rows = items.map(normalizeTrack).filter(Boolean);
          results.track = resolveAudio ? await resolveTracksAudio(rows) : rows;
          break;
        }
        case "album":
          results.album = items.map(normalizeAlbum).filter(Boolean);
          break;
        case "artist":
          results.artist = items.map(normalizeArtist).filter(Boolean);
          break;
        case "playlist":
          results.playlist = items.map(normalizePlaylist).filter(Boolean);
          break;
      }
      total += items.length;
    })
  );

  for (const type of types) {
    if (!results[type]) results[type] = [];
  }

  return { total, results };
};

const getTrackById = async (id) => {
  try {
    const data = await wxfGet(`/track/${id}`);
    const track = normalizeTrack(data.track);
    if (!track) return null;
    const resolved = await resolveTracksAudio([track]);
    return resolved[0] || track;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

// Resolves a playable, full-length audio URL for a Spotify track. Spotify only
// exposes 30s previews, so the track's metadata is matched against Saavn and
// the best full-length copy's audio URL is returned. Falls back to the
// original preview URL when nothing full is found.
const getTrackStream = async (id) => {
  const track = await getTrackById(id);
  if (!track) return null;

  const resolved = await resolvePlayableAudio({
    name: track.name,
    artist: track.artist_name,
    audioUrl: track.audio,
    duration: track.duration,
    source: "spotify",
    id: track.id,
  });

  return {
    ...track,
    audio: resolved.audioUrl,
    duration: resolved.duration || track.duration,
    is_full_audio: !isPreviewAudioUrl(resolved.audioUrl),
  };
};

const getAlbumById = async (id) => {
  try {
    const data = await wxfGet(`/album/${id}`);
    const album = normalizeAlbum(data.album);
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
    const data = await wxfGet(`/artist/${id}`);
    return normalizeArtist(data.artist);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

const getArtistTopTracks = async (id) => {
  try {
    const data = await wxfGet(`/artist/${id}/top-tracks`);
    const results = await resolveTracksAudio((data.tracks || []).map(normalizeTrack).filter(Boolean));
    return { total: data.total || results.length, results };
  } catch (err) {
    if (isNotFound(err)) return { total: 0, results: [] };
    throw err;
  }
};

const getArtistAlbums = async (id, opts = {}) => {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  const type = opts.type || "album";
  try {
    const data = await wxfGet(`/artist/${id}/albums`, { type, limit, offset });
    const results = (data.albums || []).map(normalizeAlbum).filter(Boolean);
    return { total: data.total || results.length, results };
  } catch (err) {
    if (isNotFound(err)) return { total: 0, results: [] };
    throw err;
  }
};

const getPlaylistById = async (id) => {
  try {
    const data = await wxfGet(`/playlist/${id}`);
    const playlist = normalizePlaylist(data.playlist);
    if (playlist && playlist.songs && playlist.songs.length) {
      playlist.songs = await resolveTracksAudio(playlist.songs);
    }
    return playlist;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

// Upstream health/uptime probe.
const getHealth = async () => {
  const data = await wxfGet("/health");
  return data;
};

// Returns a live anonymous Spotify web-player Bearer token (~1h validity) so
// callers can hit the real Spotify API directly for richer metadata. Note:
// even authenticated, the Spotify API only exposes 30s previews — full audio
// still comes from Saavn in this backend.
const getToken = async () => {
  const data = await wxfGet("/token");
  return data;
};

module.exports = {
  search,
  getTrackById,
  getTrackStream,
  getAlbumById,
  getArtistById,
  getArtistTopTracks,
  getArtistAlbums,
  getPlaylistById,
  getHealth,
  getToken,
};