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
};
