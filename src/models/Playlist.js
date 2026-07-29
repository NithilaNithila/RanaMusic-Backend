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
    isPublic: {
      type: Boolean,
      default: false,
    },
    tracks: [trackSnapshotSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Playlist", playlistSchema);
