const normalizeImageUrl = (value) => {
  const url = typeof value === "string" ? value.trim() : "";
  if (!/^https?:\/\//i.test(url)) return "";
  return url.replace(
    /^(https?:\/\/c\.saavncdn\.com)\/editorial\/logo\//i,
    "$1/editorial/"
  );
};

const getImage = (images, quality = "500x500") => {
  const candidates = Array.isArray(images) ? images : [images];
  const imageUrl = (image) =>
    normalizeImageUrl(typeof image === "object" && image !== null ? image.url : image);
  const preferred = candidates.find((image) => image?.quality === quality);
  const preferredUrl = imageUrl(preferred);
  if (preferredUrl) return preferredUrl;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const url = imageUrl(candidates[index]);
    if (url) return url;
  }
  return "";
};

const getDownloadUrl = (urls, quality = "320kbps") => {
  if (!Array.isArray(urls)) return "";
  const match = urls.find((u) => u.quality === quality);
  return match ? match.url : urls[urls.length - 1]?.url || "";
};

const nameOf = (a) => (a && typeof a.name === "string" ? a.name.trim() : "");

const getPrimaryArtist = (artists) => {
  if (!artists?.primary?.length) return "";
  return artists.primary.map(nameOf).filter(Boolean).join(", ");
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
          name: nameOf(a),
          image: getImage(a.image),
          url: a.url || "",
        })),
        featured: (song.artists.featured || []).map((a) => ({
          id: a.id,
          name: nameOf(a),
          image: getImage(a.image),
          url: a.url || "",
        })),
      }
    : { primary: [], featured: [] },
});

const normalizePlaylist = (playlist) => {
  const songs = Array.isArray(playlist.songs)
    ? playlist.songs.filter((song) => song && typeof song === "object")
    : [];
  const image =
    getImage(playlist.image) ||
    songs.map((song) => getImage(song.image)).find(Boolean) ||
    "";

  return {
    id: playlist.id,
    name: playlist.name,
    type: "playlist",
    image,
    language: playlist.language || "",
    url: playlist.url || "",
    track_count: playlist.songCount || playlist.totalSongs || 0,
    songs: songs.map(normalizeTrack),
  };
};

const normalizeAlbum = (album) => {
  if (!album || !album.id || !album.name) return null;
  return {
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
  };
};

const getCollectionCount = (items) => {
  if (Array.isArray(items)) return items.length;
  if (!items || typeof items !== "object") return 0;
  if (Array.isArray(items.songs)) return items.songs.length;
  if (Array.isArray(items.albums)) return items.albums.length;
  return items.total || 0;
};

const normalizeArtist = (artist) => ({
  id: artist.id,
  name: artist.name,
  type: "artist",
  image: getImage(artist.image),
  role: artist.role || "Artist",
  url: artist.url || "",
  song_count: artist.songCount || getCollectionCount(artist.topSongs),
  album_count: artist.albumCount || getCollectionCount(artist.topAlbums),
});

module.exports = {
  getImage,
  getDownloadUrl,
  getPrimaryArtist,
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
};
