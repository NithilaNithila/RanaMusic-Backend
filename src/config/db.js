const mongoose = require("mongoose");
const { logger } = require("../services/logger.service");

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
  } catch (err) {
    logger.fatal({ err: { message: err.message } }, "MongoDB connection error");
    process.exit(1);
  }
};

module.exports = connectDB;
