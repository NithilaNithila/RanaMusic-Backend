const mapArtists = (artist = {}) => {
  const name = artist.name || "";
  return name ? [{ id: artist.id || "", name }] : [];
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
    image: track.image || "",
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
    image: album.image || "",
    year,
    song_count: album.totalSongs || album.songs?.length || 0,
    url: album.url || "",
    play_count: 0,
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
    image: artist.image || "",
    role: "Artist",
    genres: [],
    followers: 0,
    popularity: 0,
    url: artist.url || "",
  };
};

const normalizePlaylist = (playlist = {}) => {
  if (!playlist || !playlist.id) return null;
  return {
    id: playlist.id,
    name: playlist.name || playlist.title || "",
    type: "playlist",
    image: playlist.image || "",
    owner: {
      id: "",
      name: playlist.createdBy || "",
    },
    description: "",
    url: playlist.url || "",
    followers: 0,
    track_count: playlist.totalSongs || playlist.songs?.length || 0,
    songs: (playlist.songs || []).map(mapTrack).filter(Boolean),
  };
};

module.exports = {
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
};
