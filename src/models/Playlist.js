const mongoose = require("mongoose");

// Tracks come from Jamendo, so we store just enough info to render them
// without re-fetching, plus the Jamendo track id as the source of truth.
const trackSnapshotSchema = new mongoose.Schema(
  {
    jamendoId: { type: String, required: true },
    name: String,
    artistName: String,
    albumImage: String,
    audioUrl: String,
    duration: Number,
  },
  { _id: false }
);

const playlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    coverImage: {
      type: String,
      default: "",
    },
    language: {
      type: String,
      default: "hi",
      index: true,
    },
    isPublic: {
      type: Boolean,
      default: false,
      index: true,
    },
    tracks: [trackSnapshotSchema],
  },
  { timestamps: true }
);

// Composite indexes for the most common public/browse queries:
// - GET /public?language=hi  sorted by createdAt
// - GET /all  -> user OR public
playlistSchema.index({ isPublic: 1, createdAt: -1 });
playlistSchema.index({ language: 1, isPublic: 1, createdAt: -1 });
playlistSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Playlist", playlistSchema);
