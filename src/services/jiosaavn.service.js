const axios = require("axios");
const forge = require("node-forge");
const { httpAgent, httpsAgent } = require("../config/http");
const { normalizeTrack, normalizeAlbum, normalizeArtist } = require("./saavn.mappers");
const { logger } = require("./logger.service");
const { getCache, setCache, makeCacheKey } = require("./cache.service");
const { sanitizePagination } = require("../utils/pagination");
const { retry } = require("../utils/retry");

const API_BASE = "https://www.jiosaavn.com/api.php";
const DECRYPT_KEY = "38346591";

const client = axios.create({
  timeout: 8000, // Reduced from 15s to 8s for faster failure
  httpAgent,
  httpsAgent,
  headers: {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    referer: "https://www.jiosaavn.com/",
  },
});

const jiosaavnGet = async (call, params = {}, { includeCtx = true } = {}) => {
  const cacheKey = makeCacheKey(`jiosaavn:${call}`, { ...params, mode: includeCtx ? "v4" : "legacy" });
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const extra = includeCtx ? { _marker: "0", api_version: "4", ctx: "web6dot0" } : {};
  const data = await retry(
    async () => {
      const res = await client.get(API_BASE, {
        params: {
          __call: call,
          _format: "json",
          ...extra,
          ...params,
        },
      });
      return res.data;
    },
    { retries: 2, baseMs: 300 }
  );

  setCache(cacheKey, data);
  return data;
};

const decryptMediaUrl = (encrypted) => {
  if (!encrypted) return null;
  try {
    const decipher = forge.cipher.createDecipher("DES-ECB", forge.util.createBuffer(DECRYPT_KEY));
    decipher.start({ iv: forge.util.createBuffer("00000000") });
    decipher.update(forge.util.createBuffer(forge.util.decode64(encrypted)));
    decipher.finish();
    return decipher.output.getBytes();
  } catch (err) {
    logger.warn({ err: { message: err.message } }, "jiosaavn decryptMediaUrl failed");
    return null;
  }
};

const buildDownloadLinks = (encrypted) => {
  const base = decryptMediaUrl(encrypted);
  if (!base) return [];
  const qualities = [
    { quality: "12kbps", suffix: "_12" },
    { quality: "48kbps", suffix: "_48" },
    { quality: "96kbps", suffix: "_96" },
    { quality: "160kbps", suffix: "_160" },
    { quality: "320kbps", suffix: "_320" },
  ];
  return qualities.map((q) => ({ quality: q.quality, url: base.replace("_96", q.suffix) }));
};

const buildImageLinks = (url) => {
  if (!url) return [];
  const qualities = ["50x50", "150x150", "500x500"];
  const sizeRegex = /150x150|50x50/;
  return qualities.map((quality) => ({
    quality,
    url: url.replace(sizeRegex, quality).replace(/^http:\/\//, "https://"),
  }));
};

const parseArtistList = (names, ids) => {
  const nameList = (names || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  const idList = (ids || "")
    .split(",")
    .map((i) => i.trim())
    .filter(Boolean);
  return nameList.map((name, idx) => ({
    id: idList[idx] || "",
    name,
    image: [],
    url: "",
  }));
};

const mapArtistMap = (artists) =>
  (artists || [])
    .filter((a) => a && a.name)
    .map((a) => ({
      id: a.id,
      name: a.name.trim(),
      image: buildImageLinks(a.image),
      url: a.perma_url || "",
    }));

const toTrackShape = (raw) => {
  const mi = raw.more_info || {};
  const artistMap = mi.artistMap || {};
  const primary =
    (Array.isArray(artistMap.primary_artists) && artistMap.primary_artists.length
      ? mapArtistMap(artistMap.primary_artists)
      : parseArtistList(raw.primary_artists, raw.primary_artists_id));
  const featured =
    (Array.isArray(artistMap.featured_artists) && artistMap.featured_artists.length
      ? mapArtistMap(artistMap.featured_artists)
      : parseArtistList(raw.featured_artists, raw.featured_artists_id));
  return {
    id: raw.id,
    name: raw.song || raw.title,
    album: { id: raw.albumid || mi.album_id || "", name: raw.album || mi.album || "" },
    image: buildImageLinks(raw.image),
    downloadUrl: buildDownloadLinks(raw.encrypted_media_url || mi.encrypted_media_url),
    duration: parseInt(raw.duration, 10) || parseInt(mi.duration, 10) || 0,
    playCount: parseInt(raw.play_count, 10) || 0,
    year: raw.year || "",
    language: raw.language || "",
    label: raw.label || mi.label || "",
    url: raw.perma_url || raw.vlink || mi.vlink || "",
    hasLyrics: (raw.has_lyrics || mi.has_lyrics) === "true",
    copyright: raw.copyright_text || mi.copyright_text || "",
    artists: { primary, featured },
  };
};

const toAlbumShape = (raw) => {
  const mi = raw.more_info || {};
  const artistMap = mi.artistMap || {};
  const primary =
    (Array.isArray(artistMap.primary_artists) && artistMap.primary_artists.length
      ? mapArtistMap(artistMap.primary_artists)
      : parseArtistList(raw.primary_artists, raw.primary_artists_id));
  const songCount =
    parseInt(mi.song_count, 10) ||
    (Array.isArray(raw.songs) ? raw.songs.length : 0) ||
    0;
  return {
    id: raw.albumid || raw.id,
    name: raw.title || raw.name,
    artists: { primary, featured: [] },
    image: buildImageLinks(raw.image),
    year: raw.year || "",
    songCount,
    language: raw.language || "",
    url: raw.perma_url || mi.album_url || "",
    playCount: parseInt(raw.play_count, 10) || 0,
    songs: Array.isArray(raw.songs) ? raw.songs.map(toTrackShape) : [],
  };
};

const toArtistShape = (raw) => {
  const topSongs = raw.topSongs;
  const topAlbums = raw.topAlbums;
  const songCount = topSongs?.total || (Array.isArray(topSongs) ? topSongs.length : topSongs?.songs?.length) || 0;
  const albumCount =
    (Array.isArray(topAlbums) ? topAlbums.length : topAlbums?.total) ||
    topAlbums?.albums?.length ||
    0;
  return {
    id: raw.id || raw.artistId,
    name: raw.name,
    image: buildImageLinks(raw.image),
    role: raw.role || raw.subtitle || "Artist",
    url: raw.perma_url || raw.urls?.overview || "",
    songCount,
    albumCount,
  };
};

const searchTracks = async (query, opts = {}) => {
  const { page, limit } = sanitizePagination(opts);
  const data = await jiosaavnGet("search.getResults", { q: query, p: page + 1, n: limit });
  const results = (data.results || []).map((s) => normalizeTrack(toTrackShape(s)));
  return { total: data.total || results.length, results };
};

const searchAlbums = async (query, opts = {}) => {
  const { page, limit } = sanitizePagination(opts);
  const data = await jiosaavnGet("search.getAlbumResults", { q: query, p: page + 1, n: limit });
  const results = (data.results || []).map((a) => normalizeAlbum(toAlbumShape(a)));
  return { total: data.total || results.length, results };
};

const searchArtists = async (query, opts = {}) => {
  const { page, limit } = sanitizePagination(opts);
  const data = await jiosaavnGet("search.getArtistResults", { q: query, p: page + 1, n: limit });
  const results = (data.results || []).map((a) => normalizeArtist(toArtistShape(a)));
  return { total: data.total || results.length, results };
};

const getTrackById = async (id) => {
  const data = await jiosaavnGet("song.getDetails", { pids: id });
  const songs = data.songs || [];
  return songs.length ? normalizeTrack(toTrackShape(songs[0])) : null;
};

const getAlbumById = async (id) => {
  const data = await jiosaavnGet("content.getAlbumDetails", { albumid: id }, { includeCtx: false });
  return data ? normalizeAlbum(toAlbumShape(data)) : null;
};

const getArtistById = async (id, { songCount = 10, albumCount = 10 } = {}) => {
  const data = await jiosaavnGet("artist.getArtistPageDetails", {
    artistId: id,
    n_song: songCount,
    n_album: albumCount,
    page: 0,
    sort_order: "popularity",
    category: "popularity",
  });
  return data ? normalizeArtist(toArtistShape(data)) : null;
};

const getArtistSongs = async (id, opts = {}) => {
  const { page, limit } = sanitizePagination(opts);
  const sortBy = opts.sortBy || "popularity";
  const sortOrder = opts.sortOrder || "desc";
  const data = await jiosaavnGet("artist.getArtistMoreSong", {
    artistId: id,
    page: page + 1,
    sort_order: sortOrder,
    category: sortBy,
  });
  const topSongs = data.topSongs || {};
  const list = Array.isArray(topSongs) ? topSongs : topSongs.songs || [];
  const results = list.map((s) => normalizeTrack(toTrackShape(s))).slice(0, limit);
  return { total: topSongs.total || results.length, results };
};

const getArtistAlbums = async (id, opts = {}) => {
  const { page } = sanitizePagination(opts);
  const sortBy = opts.sortBy || "latest";
  const sortOrder = opts.sortOrder || "desc";
  const data = await jiosaavnGet("artist.getArtistMoreAlbum", {
    artistId: id,
    page: page + 1,
    sort_order: sortOrder,
    category: sortBy,
  });
  const topAlbums = data.topAlbums || {};
  const list = Array.isArray(topAlbums) ? topAlbums : topAlbums.albums || [];
  const results = list.map((a) => normalizeAlbum(toAlbumShape(a)));
  return { total: topAlbums.total || results.length, results };
};

const getLyrics = async (id) => {
  try {
    const data = await jiosaavnGet("lyrics.getLyrics", { lyrics_id: id });
    return data.lyrics || null;
  } catch (err) {
    logger.warn({ err: { message: err.message }, id }, "jiosaavn getLyrics failed");
    return null;
  }
};

// Same fuzzy matching as saavn.service — direct JioSaavn search + lyrics.
// Unicode-aware: preserves letters from any script (Hindi, Tamil, etc.)
const normalizeName = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s*-\s*(original|official|full video|lyric|ft\.?)\s*.*/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const pickBestMatches = (tracks, artist, title, top = 4) => {
  const wantT = normalizeName(title);
  const wantA = normalizeName(artist);
  if (!wantT) return [];

  const scored = [];
  for (const t of tracks) {
    const tT = normalizeName(t.name);
    const tA = normalizeName(t.artist_name);
    if (!tT) continue;

    const titleMatch = tT === wantT ? 30 : tT.includes(wantT) || wantT.includes(tT) ? 12 : 0;
    if (!titleMatch) continue;
    const artistMatch =
      !wantA || !tA
        ? 0
        : tA === wantA
          ? 8
          : tA.includes(wantA) || wantA.includes(tA)
            ? 3
            : 0;
    if (titleMatch + artistMatch <= 0) continue;
    scored.push({ track: t, score: titleMatch + artistMatch });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, top).map((s) => s.track);
};

const getLyricsByTitle = async (artist, title) => {
  try {
    const data = await jiosaavnGet("search.getResults", { q: `${title} ${artist}`, p: 1, n: 8 });
    const songs = (data.results || []).map((s) => {
      const shaped = toTrackShape(s);
      return {
        ...normalizeTrack(shaped),
        lyricsId: s.more_info?.lyrics_id || shaped.lyricsId || "",
      };
    });

    for (const hit of pickBestMatches(songs, artist, title)) {
      const lyrics = await getLyrics(hit.lyricsId || hit.id);
      if (lyrics) return lyrics;
    }
    return null;
  } catch (err) {
    logger.warn({ err: { message: err.message }, title, artist }, "jiosaavn getLyricsByTitle failed");
    return null;
  }
};

module.exports = {
  searchTracks,
  searchAlbums,
  searchArtists,
  getTrackById,
  getAlbumById,
  getArtistById,
  getArtistSongs,
  getArtistAlbums,
  getLyrics,
  getLyricsByTitle,
};
