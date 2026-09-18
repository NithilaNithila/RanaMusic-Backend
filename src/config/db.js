const mongoose = require("mongoose");
const { logger } = require("../services/logger.service");

const syncIndexes = async () => {
  try {
    await mongoose.connection.db.dropDatabase();
    await Promise.all([
      User.ensureIndex({ email: 1 }, { unique: true }),
      User.ensureIndex({ username: 1 }, { unique: true }),
      Playlist.ensureIndex({ user: 1, isPublic: 1, createdAt: -1 }),
      Playlist.ensureIndex({ language: 1, isPublic: 1, createdAt: -1 }),
      Playlist.ensureIndex({ user: 1, createdAt: -1 }),
      PlaylistTrack.ensureIndex({ playlist: 1, position: 1 }, { unique: true }),
      PlaylistTrack.ensureIndex({ playlist: 1, jamendoId: 1 }, { unique: true }),
      Favorite.ensureIndex({ user: 1, itemType: 1, jamendoId: 1 }, { unique: true }),
      Favorite.ensureIndex({ user: 1, createdAt: -1 }),
      LikedSong.ensureIndex({ user: 1, trackId: 1 }, { unique: true }),
      LikedSong.ensureIndex({ user: 1, createdAt: -1 }),
      History.ensureIndex({ user: 1, playedAt: 1 }),
      History.ensureIndex({ playedAt: 1 }),
    ]);
    logger.info("Database indexes synced");
  } catch (err) {
    logger.error({ err }, "Error syncing database indexes");
  }
};

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      // Connection pooling + performance tuning:
      maxPoolSize: 20,          // Reuse connections instead of new ones per query
      minPoolSize: 2,           // Keep warm connections ready
      serverSelectionTimeoutMS: 10000,  // Fail fast instead of hanging
      timeoutMS: 45000,         // Don't let slow queries block the pool
      autoIndex: process.env.NODE_ENV !== "production", // Auto-create indexes only in dev
      maxIdleTimeMS: 10000,     // Recycle idle connections
    });
    logger.info({ host: conn.connection.host }, "MongoDB connected");
    if (process.env.NODE_ENV === "production") {
      await syncIndexes();
    }
  } catch (err) {
    logger.fatal({ err: { message: err.message } }, "MongoDB connection error");
    process.exit(1);
  }
};

module.exports = connectDB;
