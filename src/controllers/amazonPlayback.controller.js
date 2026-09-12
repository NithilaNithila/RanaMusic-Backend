const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const amazonService = require("../services/amazon.service");

// Seeds a new playback session/queue from a playParams object. The response is
// the official Amazon shape (entities window + metadata); the frontend plays
// entity.track.playbackInformation and reports events back.
const createSession = asyncHandler(async (req, res) => {
  const data = await amazonService.createPlaybackSession(req.body || {});
  return ApiResponse.success(res, data);
});

const currentTrack = asyncHandler(async (req, res) => {
  const data = await amazonService.getPlaybackCurrent(req.params.sessionId);
  return ApiResponse.success(res, data);
});

const nextTracks = asyncHandler(async (req, res) => {
  const data = await amazonService.getPlaybackNext(req.params.sessionId, req.query.limit);
  return ApiResponse.success(res, data);
});

const previousTracks = asyncHandler(async (req, res) => {
  const data = await amazonService.getPlaybackPrevious(req.params.sessionId, req.query.limit);
  return ApiResponse.success(res, data);
});

const queue = asyncHandler(async (req, res) => {
  const data = await amazonService.getPlaybackQueue(req.params.sessionId, req.query.limit);
  return ApiResponse.success(res, data);
});

const activeSessions = asyncHandler(async (req, res) => {
  const data = await amazonService.getActivePlaybackSessions();
  return ApiResponse.success(res, data);
});

const restoreSession = asyncHandler(async (req, res) => {
  const data = await amazonService.restorePlaybackSession(
    req.params.sessionId,
    req.params.entityReferenceId,
    req.query.limit
  );
  return ApiResponse.success(res, data);
});

const queueNext = asyncHandler(async (req, res) => {
  const data = await amazonService.queuePlaybackNext(req.params.sessionId, req.body || {});
  return ApiResponse.success(res, data, "Track queued", 201);
});

const queueLast = asyncHandler(async (req, res) => {
  const data = await amazonService.queuePlaybackLast(req.params.sessionId, req.body || {});
  return ApiResponse.success(res, data, "Track queued", 201);
});

const setLoop = asyncHandler(async (req, res) => {
  const data = await amazonService.setPlaybackLoop(req.params.sessionId, req.body || {});
  return ApiResponse.success(res, data);
});

const setShuffle = asyncHandler(async (req, res) => {
  const data = await amazonService.setPlaybackShuffle(req.params.sessionId, req.body || {});
  return ApiResponse.success(res, data);
});

const reportEvent = asyncHandler(async (req, res) => {
  const data = await amazonService.reportPlaybackEvent(req.body || {});
  return ApiResponse.success(res, data, "Event reported", 201);
});

const reportEvents = asyncHandler(async (req, res) => {
  const data = await amazonService.reportPlaybackEvents(req.body || {});
  return ApiResponse.success(res, data, "Events reported", 201);
});

module.exports = {
  createSession,
  currentTrack,
  nextTracks,
  previousTracks,
  queue,
  activeSessions,
  restoreSession,
  queueNext,
  queueLast,
  setLoop,
  setShuffle,
  reportEvent,
  reportEvents,
};