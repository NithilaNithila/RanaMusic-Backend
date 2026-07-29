const mongoose = require("mongoose");

const historySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    jamendoId: {
      type: String,
      required: true,
    },
    name: String,
    artistName: String,
    albumImage: String,
    playedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

historySchema.index({ user: 1, playedAt: -1 });

module.exports = mongoose.model("History", historySchema);
