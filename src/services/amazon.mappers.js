const { toProxyUrl } = require("../utils/imageProxy");

const mapArtists = (artist = {}) => {
  const name = artist.name || "";
  return name ? [{ id: artist.id || "", name }] : [];
};

// MRN (Music Resource Name) used to seed playback sessions. Prefer whatever
// Amazon gave us; otherwise synthesize one so every catalog item is playable
// via /api/amazon/playback/sessions.
const playParamsOf = (kind, id, containerId) => {
  const base = { id: `mrn:1.0:catalog:${kind}:asin:${id}` };
  if (containerId) base.containerIds = [`mrn:1.0:catalog:album:asin:${containerId}`];
  base.selections = ["PLAY", "SHUFFLE", "STATION"];
  return base;
};

const mapTrack = (track = {}, albumFallback) => {
  if (!track || !track.id) return null;
  const artistObj = track.artist || {};
  const albumObj = track.album || albumFallback || {};
  const artists = mapArtists(artistObj);
  return {
    id: track.id,
    name: track.title || track.name || "",
    type: "track",
    source: "amazon",
    artist_name: artists.map((a) => a.name).join(", ") || "",
    album_name: albumObj.name || "",
    album_id: albumObj.id || "",
    image: toProxyUrl(track.image || ""),
    audio: "",
    duration: track.duration || 0,
    year: "",
    play_count: 0,
    language: "",
    label: "",
    url: track.url || "",
    has_lyrics: false,
    copyright: "",
    artists: { primary: artists, featured: [] },
    playParams: track.playParams || playParamsOf("track", track.id, albumObj.id),
  };
};

const normalizeTrack = (track = {}) => mapTrack(track);

const normalizeAlbum = (album = {}) => {
  if (!album || !album.id) return null;
  const artistObj = album.artist || {};
  const artists = mapArtists(artistObj);
  const year = (album.releaseDate || "").match(/\d{4}/)?.[0] || "";
  return {
    id: album.id,
    name: album.name || album.title || "",
    type: "album",
    artist_name: artists.map((a) => a.name).join(", ") || "",
    image: toProxyUrl(album.image || ""),
    year,
    song_count: album.totalSongs || album.songs?.length || 0,
    url: album.url || "",
    play_count: 0,
    playParams: album.playParams || playParamsOf("album", album.id),
    songs: (album.songs || [])
      .map((t) =>
        mapTrack(t, { id: album.id, name: album.name || album.title })
      )
      .filter(Boolean),
  };
};

const normalizeArtist = (artist = {}) => {
  if (!artist || !artist.id) return null;
  return {
    id: artist.id,
    name: artist.name || artist.title || "",
    type: "artist",
    image: toProxyUrl(artist.image || ""),
    role: "Artist",
    genres: [],
    followers: 0,
    popularity: 0,
    url: artist.url || "",
    playParams: artist.playParams || playParamsOf("artist", artist.id),
  };
};

const normalizePlaylist = (playlist = {}) => {
  if (!playlist || !playlist.id) return null;
  return {
    id: playlist.id,
    name: playlist.name || playlist.title || "",
    type: "playlist",
    image: toProxyUrl(playlist.image || ""),
    owner: {
      id: "",
      name: playlist.createdBy || "",
    },
    description: "",
    url: playlist.url || "",
    followers: 0,
    track_count: playlist.totalSongs || playlist.songs?.length || 0,
    playParams: playlist.playParams || playParamsOf("playlist", playlist.id),
    songs: (playlist.songs || []).map(mapTrack).filter(Boolean),
  };
};

module.exports = {
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
};
