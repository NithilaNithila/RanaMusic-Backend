const mongoose = require("mongoose");

// A track inside a playlist. Stored as its own document (not an embedded array)
// so playlists can grow unbounded (thousands of tracks) without bloating the
// Playlist document toward MongoDB's 16MB-per-document limit, and so adding /
// removing a track only rewrites one small document instead of the whole array.
const playlistTrackSchema = new mongoose.Schema(
  {
    playlist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Playlist",
      required: true,
      index: true,
    },
    // Stable source-of-truth track id (Jamendo id or unified provider id).
    jamendoId: {
      type: String,
      required: true,
    },
    // 1-based display order; kept explicit so reordering is trivial later.
    position: {
      type: Number,
      required: true,
    },
    name: String,
    artistName: String,
    albumImage: String,
    audioUrl: String,
    // Source + YouTube videoId let playlist tracks fall back to a client-side
    // YouTube embed when no Saavn copy exists (same contract as search rows).
    source: String,
    videoId: String,
    duration: Number,
  },
  { timestamps: true }
);

// A track appears at most once per playlist.
playlistTrackSchema.index({ playlist: 1, jamendoId: 1 }, { unique: true });
// Position must be unique within a playlist.
playlistTrackSchema.index({ playlist: 1, position: 1 }, { unique: true });

module.exports = mongoose.model("PlaylistTrack", playlistTrackSchema);
