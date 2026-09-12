// yt-dlp search-entry mappers for the unified search service.
//
// yt-dlp's ytsearch returns plain YouTube video entries (id / title /
// duration / thumbnails / channel), so rows are normalized to the same
// unified shape the other providers use. Audio is the in-process proxy URL
// (`/api/ytmusic/songs/:id/stream`), which is how YouTube rows stay playable
// without another Saavn round-trip.

const watchUrl = (videoId) =>
  videoId ? `https://music.youtube.com/watch?v=${videoId}` : "";

// youtube thumbnails are ordered smallest → largest; keep the largest.
const getImage = (entry) => {
  const thumbs = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
  for (let i = thumbs.length - 1; i >= 0; i -= 1) {
    if (thumbs[i] && thumbs[i].url) return thumbs[i].url;
  }
  return entry.thumbnail || "";
};

const normalizeSearchTrack = (entry) => {
  const videoId = entry && entry.id;
  if (!videoId) return null;
  const artistName = String(entry.channel || entry.uploader || "").trim();
  return {
    id: videoId,
    // Flat-playlist search entries can ship a trailing/leading space in the
    // title (e.g. "... (Official Lyric Video) "); trim it for clean UI text.
    name: String(entry.title || "").trim(),
    type: "track",
    source: "ytmusic",
    artist_name: artistName,
    album_name: "",
    album_id: "",
    image: getImage(entry),
    audio: `/api/ytmusic/songs/${videoId}/stream`,
    duration: Number(entry.duration) || 0,
    year: "",
    play_count: Number(entry.view_count) || 0,
    language: "",
    label: "",
    url: watchUrl(videoId),
    has_lyrics: false,
    copyright: "",
    isExplicit: false,
    artists: {
      primary: artistName ? [{ id: entry.channel_id || "", name: artistName }] : [],
      featured: [],
    },
  };
};

module.exports = { getImage, normalizeSearchTrack };