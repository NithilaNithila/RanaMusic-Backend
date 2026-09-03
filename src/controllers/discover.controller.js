const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const { buildFeed } = require("../services/discover.service");

// GET /api/discover?lang=hi&limit=12
// Daily-rotating home feed: trending tracks, albums, artists and playlists.
const discover = asyncHandler(async (req, res) => {
  const { lang, limit } = req.query;
  const data = await buildFeed({ lang, limit });
  return ApiResponse.success(res, data, "Discover feed");
});

module.exports = { discover };
