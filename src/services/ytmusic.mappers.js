const getImage = (thumbnails) => {
  if (!Array.isArray(thumbnails) || !thumbnails.length) return "";
  // YouTube Music returns thumbnails sorted smallest to largest; pick the
  // largest (first element) for best quality.
  return thumbnails[0]?.url || "";
};

const parseDuration = (value) => {
  if (!value) return 0;
  const parts = String(value).split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
};

const parseCount = (value) => {
  if (!value) return 0;
  if (typeof value === "number") return value;
  const match = String(value).replace(/,/g, "").match(/^([\d.]+)\s*([KMB]?)/i);
  if (!match) return 0;
  const multiplier = { k: 1e3, m: 1e6, b: 1e9 };
  return Math.round(parseFloat(match[1]) * (multiplier[match[2].toLowerCase()] || 1));
};

const mapArtists = (artists) =>
  (artists || [])
    .map((a) => ({
      id: a?.id || a?.channelId || "",
      name: a?.name || "",
    }))
    .filter((a) => a.name);

const watchUrl = (videoId) =>
  videoId ? `https://music.youtube.com/watch?v=${videoId}` : "";

const normalizeTrack = (track = {}) => {
  const videoId = track.videoId;
  if (!videoId) return null;
  const primary = mapArtists(track.artists);
  const album =
    track.album && typeof track.album === "object"
      ? track.album
      : { name: typeof track.album === "string" ? track.album : "", id: "" };
  const duration =
    track.duration_seconds ||
    (track.duration_ms ? Math.round(track.duration_ms / 1000) : 0) ||
    parseDuration(track.duration || track.length);
  return {
    id: videoId,
    name: track.title || "",
    type: "track",
    source: "ytmusic",
    artist_name: primary.map((a) => a.name).join(", "),
    album_name: album.name || "",
    album_id: album.id || "",
    image: getImage(track.thumbnails) || getImage(track.thumbnail),
    audio: track.audio || "",
    duration,
    year: track.year ? String(track.year).slice(0, 4) : "",
    play_count: parseCount(track.views),
    language: "",
    label: "",
    url: watchUrl(videoId),
    has_lyrics: Boolean(track.has_lyrics),
    copyright: "",
    isExplicit: Boolean(track.isExplicit),
    artists: { primary, featured: [] },
  };
};

const normalizeAlbum = (album = {}, idOverride = "") => {
  if (!album) return null;
  const id = idOverride || album.browseId || album.audioPlaylistId || album.id || "";
  if (!id && !Array.isArray(album.tracks)) return null;
  const primary = mapArtists(album.artists);
  return {
    id,
    name: album.title || album.name || "",
    type: "album",
    artist_name: primary.map((a) => a.name).join(", ") || album.artist || "",
    image: getImage(album.thumbnails),
    year: album.year ? String(album.year).slice(0, 4) : "",
    song_count: album.trackCount || album.tracks?.length || 0,
    url: "",
    play_count: 0,
    songs: (album.tracks || [])
      .map((t) =>
        normalizeTrack({ ...t, album: { id, name: album.title || album.name } })
      )
      .filter(Boolean),
  };
};

const normalizeArtist = (artist = {}) => {
  const id = artist.channelId || artist.browseId || artist.id;
  if (!id) return null;
  return {
    id,
    name: artist.name || artist.title || "",
    type: "artist",
    image: getImage(artist.thumbnails),
    role: "Artist",
    genres: artist.genres || [],
    followers: parseCount(artist.subscribers),
    popularity: 0,
    url: `https://music.youtube.com/channel/${id}`,
  };
};

const normalizePlaylist = (playlist = {}) => {
  const id = playlist.id || playlist.playlistId || playlist.browseId;
  if (!id) return null;
  return {
    id,
    name: playlist.title || "",
    type: "playlist",
    image: getImage(playlist.thumbnails),
    owner: {
      id: playlist.author?.id || "",
      name: playlist.author?.name || "YouTube Music",
    },
    description: playlist.description || "",
    url: `https://music.youtube.com/playlist?list=${id}`,
    followers: parseCount(playlist.views),
    track_count: playlist.trackCount || playlist.tracks?.length || 0,
    songs: (playlist.tracks || []).map(normalizeTrack).filter(Boolean),
  };
};

module.exports = {
  getImage,
  parseDuration,
  parseCount,
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
};