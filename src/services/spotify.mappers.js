const parseDuration = (value) => {
  if (!value) return 0;
  const parts = String(value).split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
};

const mapArtists = (artists) =>
  (artists || [])
    .map((a) =>
      typeof a === "string"
        ? { id: "", name: a }
        : { id: a.id || a.uri?.split(":").pop() || "", name: a.name || "" }
    )
    .filter((a) => a.name);

const mapTrack = (track = {}) => {
  if (!track || (!track.id && !track.uri)) return null;
  const id = track.id || track.uri.split(":").pop();
  const primary = mapArtists(track.artists);
  return {
    id,
    name: track.title || track.name || "",
    type: "track",
    source: "spotify",
    artist_name: track.artist || primary.map((a) => a.name).join(", ") || "",
    album_name: track.album?.name || track.album || "",
    album_id: track.album?.id || track.album_id || "",
    image: track.thumbnail || track.image || "",
    audio: track.preview_url || "",
    streamUrl: `/api/spotify/tracks/${id}/stream`,
    duration:
      Math.round((track.duration_ms || 0) / 1000) || parseDuration(track.duration),
    year: (track.release_date || "").toString().slice(0, 4),
    play_count: track.play_count || 0,
    language: "",
    label: "",
    url: track.url || "",
    has_lyrics: false,
    copyright: "",
    artists: { primary, featured: [] },
  };
};

const normalizeTrack = (track = {}) => mapTrack(track);

const normalizeAlbum = (album = {}) => {
  if (!album || !album.id) return null;
  const primary = mapArtists(album.artists);
  return {
    id: album.id,
    name: album.name || album.title || "",
    type: "album",
    source: "spotify",
    artist_name: album.artist || primary.map((a) => a.name).join(", ") || "",
    image: album.thumbnail || album.image || "",
    year: (album.release_date || "").toString().slice(0, 4),
    song_count: album.total_tracks || album.tracks?.length || 0,
    url: album.url || "",
    play_count: album.play_count || 0,
    songs: (album.tracks || [])
      .map((t) =>
        mapTrack({ ...t, album: { id: album.id, name: album.name || album.title } })
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
    image: artist.thumbnail || artist.image || "",
    role: (artist.genres || []).join(", ") || "Artist",
    genres: artist.genres || [],
    followers: artist.followers || 0,
    popularity: artist.popularity || 0,
    url: artist.url || "",
  };
};

const normalizePlaylist = (playlist = {}) => {
  if (!playlist || !playlist.id) return null;
  return {
    id: playlist.id,
    name: playlist.name || playlist.title || "",
    type: "playlist",
    image: playlist.thumbnail || playlist.image || "",
    owner: {
      id: playlist.owner_id || "",
      name: playlist.owner || "",
    },
    description: playlist.description || "",
    url: playlist.url || "",
    followers: playlist.followers || 0,
    track_count: playlist.total_tracks || playlist.tracks?.length || 0,
    songs: (playlist.tracks || []).map(mapTrack).filter(Boolean),
  };
};

module.exports = {
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
};