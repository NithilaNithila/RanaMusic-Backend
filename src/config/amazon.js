// A self-hosted Amazon Music metadata API. When deploying, always set
// AMAZON_API_BASE to the actual instance; the public default below is a
// convenience so an unset variable doesn't silently point at localhost in a
// production environment.
module.exports = {
  baseURL:
    process.env.AMAZON_API_BASE ||
    (process.env.NODE_ENV === "production"
      ? "https://amazon-music-api.onrender.com/api"
      : "http://localhost:3000/api"),
};
