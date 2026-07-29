const axios = require("axios");
const saavnConfig = require("../config/saavn");
const { getCache, setCache, makeCacheKey } = require("./cache.service");

const client = axios.create({
  baseURL: saavnConfig.baseURL,
  timeout: 10000,
});

const getImage = (images, quality = "500x500") => {
  if (!Array.isArray(images)) return "";
  const match = images.find((img) => img.quality === quality);
  return match ? match.url : images[images.length - 1]?.url || "";
};

const getDownloadUrl = (urls, quality = "320kbps") => {
  if (!Array.isArray(urls)) return "";
  const match = urls.find((u) => u.quality === quality);
  return match ? match.url : urls[urls.length - 1]?.url || "";
};

const getPrimaryArtist = (artists) => {
  if (!artists?.primary?.length) return "";
  return artists.primary.map((a) => a.name.trim()).join(", ");
};

const normalizeTrack = (song) => ({
  id: song.id,
  name: song.name,
  type: "track",
  artist_name: getPrimaryArtist(song.artists),
  album_name: song.album?.name || "",
  album_id: song.album?.id || "",
  image: getImage(song.image),
  audio: getDownloadUrl(song.downloadUrl),
  duration: song.duration || 0,
  year: song.year || "",
  play_count: song.playCount || 0,
  language: song.language || "",
  label: song.label || "",
  url: song.url || "",
  has_lyrics: song.hasLyrics || false,
  copyright: song.copyright || "",
  artists: song.artists
    ? {
        primary: (song.artists.primary || []).map((a) => ({
          id: a.id,
          name: a.name.trim(),
          image: getImage(a.image),
          url: a.url || "",
        })),
        featured: (song.artists.featured || []).map((a) => ({
          id: a.id,
          name: a.name.trim(),
          image: getImage(a.image),
          url: a.url || "",
        })),
      }
    : { primary: [], featured: [] },
});

const normalizeAlbum = (album) => ({
  id: album.id,
  name: album.name,
  type: "album",
  artist_name: getPrimaryArtist(album.artists),
  image: getImage(album.image),
  year: album.year || "",
  song_count: album.songCount || 0,
  language: album.language || "",
  url: album.url || "",
  play_count: album.playCount || 0,
  songs: Array.isArray(album.songs) ? album.songs.map(normalizeTrack) : [],
});

const normalizeArtist = (artist) => ({
  id: artist.id,
  name: artist.name,
  type: "artist",
  image: getImage(artist.image),
  role: artist.role || "Artist",
  url: artist.url || "",
  song_count: artist.songCount || 0,
  album_count: artist.albumCount || 0,
});

const saavnGet = async (endpoint, params = {}) => {
  const cacheKey = makeCacheKey(`saavn:${endpoint}`, params);
  const cached = getCache(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await client.get(endpoint, { params });
    setCache(cacheKey, data);
    return data;
  } catch (err) {
    const status = err.response?.status;
    if (endpoint.includes("/lyrics") && status === 404) {
      return { data: { lyrics: null } };
    }
    if (status === 429 || status === 500 || status === 503) {
      console.warn(`Saavn API ${status} on ${endpoint}, returning empty`);
      return { data: { results: [], total: 0 } };
    }
    throw err;
  }
};

const searchTracks = async (query, { page = 0, limit = 20 } = {}) => {
  const data = await saavnGet("/search/songs", { query, page, limit });
  const results = (data.data?.results || []).map(normalizeTrack);
  return { total: data.data?.total || 0, results };
};

const searchAlbums = async (query, { page = 0, limit = 20 } = {}) => {
  const data = await saavnGet("/search/albums", { query, page, limit });
  const results = (data.data?.results || []).map(normalizeAlbum);
  return { total: data.data?.total || 0, results };
};

const searchArtists = async (query, { page = 0, limit = 20 } = {}) => {
  const data = await saavnGet("/search/artists", { query, page, limit });
  const results = (data.data?.results || []).map(normalizeArtist);
  return { total: data.data?.total || 0, results };
};

const getTrackById = async (id) => {
  const data = await saavnGet("/songs", { ids: id });
  const songs = data.data || [];
  return songs.length ? normalizeTrack(songs[0]) : null;
};

const getAlbumById = async (id) => {
  const data = await saavnGet("/albums", { id });
  return data.data ? normalizeAlbum(data.data) : null;
};

const getArtistById = async (id, { songCount = 10, albumCount = 10 } = {}) => {
  const data = await saavnGet("/artists", { id, songCount, albumCount });
  return data.data ? normalizeArtist(data.data) : null;
};

const getArtistSongs = async (id, { page = 0, sortBy = "popularity", sortOrder = "desc" } = {}) => {
  const data = await saavnGet(`/artists/${id}/songs`, { page, sortBy, sortOrder });
  const results = (data.data?.songs || []).map(normalizeTrack);
  return { total: data.data?.total || 0, results };
};

const getArtistAlbums = async (id) => {
  const data = await saavnGet(`/artists/${id}/albums`);
  const results = (data.data?.albums || []).map(normalizeAlbum);
  return { total: data.data?.total || 0, results };
};

const getLyrics = async (id) => {
  try {
    const data = await saavnGet(`/songs/${id}/lyrics`);
    return data.data?.lyrics || null;
  } catch {
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
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  getImage,
};
