const mongoose = require("mongoose");

// A song the user has liked. Tracks come from our aggregated providers, so we
// store just enough info to render/play them without re-fetching, keyed by the
// track id (which is stable across the unified track responses).
const { Schema } = mongoose;

const likedSongSchema = new Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    trackId: {
      type: String,
      required: true,
    },
    name: String,
    artistName: String,
    image: String,
    audioUrl: String,
    duration: Number,
  },
  { timestamps: true }
);

likedSongSchema.index({ user: 1, trackId: 1 }, { unique: true });
// Supports GET /api/liked-songs (newest-first list) without an in-memory sort.
likedSongSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("LikedSong", likedSongSchema);
