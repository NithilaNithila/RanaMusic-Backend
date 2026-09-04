const mongoose = require("mongoose");

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
      maxlength: 100,
    },
    description: {
      type: String,
      default: "",
      maxlength: 500,
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
