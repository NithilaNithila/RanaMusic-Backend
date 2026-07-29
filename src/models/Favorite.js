const mongoose = require("mongoose");

const favoriteSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    itemType: {
      type: String,
      enum: ["track", "album", "artist"],
      required: true,
    },
    jamendoId: {
      type: String,
      required: true,
    },
    // Cached display info so Library page doesn't need N calls to Jamendo
    meta: {
      name: String,
      image: String,
      artistName: String,
    },
  },
  { timestamps: true }
);

favoriteSchema.index({ user: 1, itemType: 1, jamendoId: 1 }, { unique: true });

module.exports = mongoose.model("Favorite", favoriteSchema);
