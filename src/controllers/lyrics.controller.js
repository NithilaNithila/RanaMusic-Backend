const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const saavnService = require("../services/saavn.service");
const ytService = require("../services/ytmusic.service");
const lrclibService = require("../services/lrclib.service");
const lyricsovhService = require("../services/lyricsovh.service");

const SOURCES = {
  saavn: saavnService.getLyrics,
  ytmusic: ytService.getLyrics,
};

// Title/artist based sources — no upstream song id required.
const TITLE_SOURCES = {
  saavn: saavnService.getLyricsByTitle,
  lrclib: lrclibService.getLyrics,
  lyricsovh: lyricsovhService.getLyrics,
};

const DEFAULT_SOURCE = "saavn";

// Lookup by upstream song id (e.g. Saavn / YouTube Music ids).
const getLyrics = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const source = (req.query.source || DEFAULT_SOURCE).toLowerCase();

  const fetcher = SOURCES[source];
  if (!fetcher) {
    return ApiResponse.error(
      res,
      `Unknown source '${source}'. Supported: ${Object.keys(SOURCES).join(", ")}`,
      400
    );
  }

  const lyrics = await fetcher(id);
  if (!lyrics) return ApiResponse.error(res, "Lyrics not found", 404);
  return ApiResponse.success(res, { source, lyrics });
});

// Lookup by artist + title — works for Jamendo-sourced tracks.
const getLyricsByTitle = asyncHandler(async (req, res) => {
  const { artist, title } = req.query;
  const source = (req.query.source || DEFAULT_SOURCE).toLowerCase();

  if (!artist || !title) {
    return ApiResponse.error(res, "Artist and title query params are required", 400);
  }

  const fetcher = TITLE_SOURCES[source];
  if (!fetcher) {
    return ApiResponse.error(
      res,
      `Unknown source '${source}'. Supported: ${Object.keys(TITLE_SOURCES).join(", ")}`,
      400
    );
  }

  const lyrics = await fetcher(artist, title);
  if (!lyrics) return ApiResponse.error(res, "Lyrics not found", 404);
  return ApiResponse.success(res, { source, lyrics });
});

module.exports = { getLyrics, getLyricsByTitle };