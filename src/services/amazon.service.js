const axios = require("axios");
const amazonConfig = require("../config/amazon");
const { httpAgent, httpsAgent } = require("../config/http");
const { getCache, setCache, makeCacheKey } = require("./cache.service");
const { retry } = require("../utils/retry");
const {
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
} = require("./amazon.mappers");
const { resolvePlayableAudio } = require("./trackResolver.service");
const mapLimit = require("../utils/mapLimit");

const client = axios.create({
  baseURL: amazonConfig.baseURL,
  timeout: 30000, // Amazon metadata calls can be slow (extra duration lookups)
  httpAgent,
  httpsAgent,
});

const clampLimit = (limit) => Math.min(Math.max(parseInt(limit, 10) || 10, 1), 10);
const clampPage = (page) => Math.min(Math.max(parseInt(page, 10) || 1, 1), 25);

const resolveTracksAudio = async (tracks) => {
  if (!tracks || !tracks.length) return tracks || [];
  return mapLimit(tracks, 5, async (track) => {
    if (!track) return track;
    try {
      const resolved = await resolvePlayableAudio({
        name: track.name,
        artist: track.artist_name,
        audioUrl: track.audio,
        duration: track.duration,
        source: "amazon",
        id: track.id,
      });
      if (resolved.audioUrl && resolved.audioUrl !== track.audio) {
        return { ...track, audio: resolved.audioUrl, duration: resolved.duration || track.duration };
      }
      if (resolved.videoId) {
        return { ...track, videoId: resolved.videoId };
      }
    } catch (_) {}
    return track;
  });
};

class AmazonError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "AmazonError";
    this.status = status;
  }
}

const isNotFound = (err) =>
  err instanceof AmazonError && (err.status === 404 || err.status === 400);

const amzGet = async (path, params = {}) => {
  const cacheKey = makeCacheKey(`amz:${path}`, params);
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const data = await retry(
    async () => {
      try {
        const res = await client.get(path, { params });
        return res.data;
      } catch (err) {
        if (err.response) {
          const upstream = new AmazonError(
            err.response.data?.message ||
              `Amazon API ${err.response.status} on ${path}`,
            err.response.status
          );
          const wait = Number(err.response.headers?.["retry-after"] || 0) * 1000;
          if (wait > 0) upstream.retryAfterMs = wait;
          throw upstream;
        }
        throw new AmazonError(`Amazon API unreachable on ${path}`);
      }
    },
    {
      retries: 2,
      baseMs: 400,
      shouldRetry: (err) => !(err instanceof AmazonError && err.status < 500 && err.status !== 429),
    }
  );

  if (!data || data.success === false) {
    throw new AmazonError(data?.message || `Amazon API error on ${path}`);
  }

  setCache(cacheKey, data);
  return data;
};

const search = async (query, opts = {}) => {
  const limit = clampLimit(opts.limit);
  const page = clampPage(opts.page);
  const type = String(opts.type || "all").toLowerCase();

  const call = async (path) => {
    const data = await amzGet(path, { query, page, limit });
    return data.data || [];
  };

  const results = {};
  let total = 0;

  const queries = [];
  if (type === "all" || type === "track") queries.push(["track", "/search/songs"]);
  if (type === "all" || type === "album") queries.push(["album", "/search/albums"]);
  if (type === "all" || type === "artist") queries.push(["artist", "/search/artists"]);
  if (type === "all" || type === "playlist") queries.push(["playlist", "/search/playlists"]);

  if (!queries.length) queries.push(["track", "/search/songs"]);

  await Promise.allSettled(
    queries.map(async ([key, path]) => {
      const items = await call(path);
      switch (key) {
        case "track":
          results.track = await resolveTracksAudio(items.map(normalizeTrack).filter(Boolean));
          break;
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

  for (const key of ["track", "album", "artist", "playlist"]) {
    if (!results[key]) results[key] = [];
  }

  return { total, results };
};

const getTrackById = async (id) => {
  try {
    const data = await amzGet(`/songs/${id}`);
    const track = normalizeTrack(data.data);
    if (!track) return null;
    const resolved = await resolveTracksAudio([track]);
    return resolved[0] || track;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

const getAlbumById = async (id) => {
  try {
    const data = await amzGet(`/albums/${id}`);
    const album = normalizeAlbum(data.data);
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
    const data = await amzGet(`/artists/${id}`);
    return normalizeArtist(data.data);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

const getArtistTopTracks = async (id, opts = {}) => {
  try {
    const data = await amzGet(`/artists/${id}`);
    const topSongs = data.data?.topSongs || [];
    const results = await resolveTracksAudio(topSongs.slice(0, clampLimit(opts.limit)).map(normalizeTrack).filter(Boolean));
    return { total: results.length, results };
  } catch (err) {
    if (isNotFound(err)) return { total: 0, results: [] };
    throw err;
  }
};

const getPlaylistById = async (id) => {
  try {
    const data = await amzGet(`/playlists/${id}`);
    const playlist = normalizePlaylist(data.data);
    if (playlist && playlist.songs && playlist.songs.length) {
      playlist.songs = await resolveTracksAudio(playlist.songs);
    }
    return playlist;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
};

// ── playback (official /v1/playback/*, proxied through the mirror) ──────

// Sends any playback call to the mirror. Playback responses are intentionally
// NOT cached (manifests expire hourly, sessions are unique) and carry the
// device/auth headers the mirror owns, so the backend stays a thin hop.
// Returns the mirror's `data` payload (the official Amazon `data` object).
const amzPlayback = async (method, path, { body, params } = {}) => {
  const data = await retry(
    async () => {
      try {
        const res = await client.request({ method, url: path, data: body, params });
        return res.data;
      } catch (err) {
        if (err.response) {
          const upstream = new AmazonError(
            err.response.data?.message ||
              `Amazon API ${err.response.status} on ${path}`,
            err.response.status
          );
          const wait = Number(err.response.headers?.["retry-after"] || 0) * 1000;
          if (wait > 0) upstream.retryAfterMs = wait;
          throw upstream;
        }
        throw new AmazonError(`Amazon API unreachable on ${path}`);
      }
    },
    {
      // GET playback reads are safe to retry on a transient blip; POSTs (seek,
      // play/pause, enqueue) are NOT — replaying them would double-fire the
      // action, so only GET is retried here.
      retries: method === "GET" ? 2 : 0,
      baseMs: 400,
      shouldRetry: (err) => !(err instanceof AmazonError && err.status < 500 && err.status !== 429),
    }
  );

  if (!data || data.success === false) {
    throw new AmazonError(data?.message || `Amazon API error on ${path}`, data?.status || 502);
  }
  return data.data;
};

const createPlaybackSession = (body) =>
  amzPlayback("post", "/playback/sessions", { body });

const getPlaybackCurrent = (sessionId) =>
  amzPlayback("get", `/playback/sessions/${sessionId}/current`);

const getPlaybackNext = (sessionId, limit) =>
  amzPlayback("get", `/playback/sessions/${sessionId}/next`, { params: limit ? { limit } : {} });

const getPlaybackPrevious = (sessionId, limit) =>
  amzPlayback("get", `/playback/sessions/${sessionId}/previous`, { params: limit ? { limit } : {} });

const getPlaybackQueue = (sessionId, limit) =>
  amzPlayback("get", `/playback/sessions/${sessionId}/queue`, { params: limit ? { limit } : {} });

const getActivePlaybackSessions = () =>
  amzPlayback("get", "/playback/sessions/active");

const restorePlaybackSession = (sessionId, entityReferenceId, limit) =>
  amzPlayback("get", `/playback/sessions/${sessionId}/entities/${entityReferenceId}`, {
    params: limit ? { limit } : {},
  });

const queuePlaybackNext = (sessionId, body) =>
  amzPlayback("post", `/playback/sessions/${sessionId}/queue/next`, { body });

const queuePlaybackLast = (sessionId, body) =>
  amzPlayback("post", `/playback/sessions/${sessionId}/queue/last`, { body });

const setPlaybackLoop = (sessionId, body) =>
  amzPlayback("put", `/playback/sessions/${sessionId}/loop`, { body });

const setPlaybackShuffle = (sessionId, body) =>
  amzPlayback("put", `/playback/sessions/${sessionId}/shuffle`, { body });

const reportPlaybackEvent = (body) => amzPlayback("post", "/playback/event", { body });

const reportPlaybackEvents = (body) => amzPlayback("post", "/playback/events", { body });

module.exports = {
  search,
  getTrackById,
  getAlbumById,
  getArtistById,
  getArtistTopTracks,
  getPlaylistById,
  createPlaybackSession,
  getPlaybackCurrent,
  getPlaybackNext,
  getPlaybackPrevious,
  getPlaybackQueue,
  getActivePlaybackSessions,
  restorePlaybackSession,
  queuePlaybackNext,
  queuePlaybackLast,
  setPlaybackLoop,
  setPlaybackShuffle,
  reportPlaybackEvent,
  reportPlaybackEvents,
};
