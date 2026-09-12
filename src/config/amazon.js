// Amazon Music provider (catalog + playback). Points at the third-party
// amazon-music-api.onrender.com deployment by default; the same base serves
// catalog reads and playback sessions. Override with AMAZON_API_BASE.
module.exports = {
  baseURL:
    process.env.AMAZON_API_BASE ||
    "https://amazon-music-api.onrender.com/api",
};
