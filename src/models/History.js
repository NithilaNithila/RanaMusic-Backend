const mongoose = require("mongoose");

const historySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    jamendoId: {
      type: String,
      required: true,
    },
    name: { type: String, maxlength: 200 },
    artistName: { type: String, maxlength: 200 },
    albumImage: { type: String, maxlength: 500 },
    playedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

// Compound index covers both user-only and user+playedAt queries.
// TTL index auto-purges history older than 90 days.
historySchema.index({ user: 1, playedAt: -1 });
historySchema.index({ playedAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model("History", historySchema);
