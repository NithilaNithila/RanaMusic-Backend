require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const routes = require("./routes/index");
const { apiLimiter } = require("./middleware/rateLimiter.middleware");
const { notFound, errorHandler } = require("./middleware/error.middleware");

const app = express();

// Trust the first proxy hop so req.ip reflects real clients instead of the
// load balancer. Required for rate limiting to work correctly behind
// Render/Koyeb/Vercel-style proxies (otherwise all users share one IP bucket).
app.set("trust proxy", 1);

app.use(helmet());
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/api", apiLimiter);

app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
