// Direct audio-stream extraction for YouTube videoIds via the public innertube
// (youtubei) player API. The ANDROID client returns plain, unsigned googlevideo
// stream URLs, so no player-JS signature deciphering is needed.
const axios = require("axios");
const { httpAgent, httpsAgent } = require("../config/http");
const { memoize, makeCacheKey } = require("./cache.service");

const YT_PLAYER_ENDPOINT = "https://www.youtube.com/youtubei/v1/player";
const INNERTUBE_API_KEY = process.env.YT_INNERTUBE_API_KEY || "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const STREAM_TTL = 300;

const client = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 15000,
  headers: {
    "content-type": "application/json",
    "user-agent": process.env.YT_INNERTUBE_UA || "Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36",
    accept: "*/*",
  },
});

const PLAYER_CLIENTS = [
  { clientName: "ANDROID", clientVersion: "20.02.35", extras: { androidSdkVersion: 30 } },
  { clientName: "ANDROID_CREATOR_LITE", clientVersion: "1.0", extras: {} },
];

// Picks the highest-bitrate audio-only stream that has a ready-to-play `url`.
const pickBestAudio = (formats) => {
  if (!Array.isArray(formats)) return null;
  const audioOnly = formats.filter(
    (f) =>
      typeof f?.mimeType === "string" &&
      f.mimeType.toLowerCase().startsWith("audio/") &&
      typeof f.url === "string" &&
      f.url.startsWith("http")
  );
  if (!audioOnly.length) return null;
  const best = [...audioOnly].sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
  return {
    audio: best.url,
    mimeType: best.mimeType.split(";")[0].trim(),
    itag: best.itag || 0,
    bitrate: best.bitrate || 0,
  };
};

const readPlayer = async (videoId, { clientName, clientVersion, extras }) => {
  const { data } = await client.post(
    `${YT_PLAYER_ENDPOINT}?key=${encodeURIComponent(INNERTUBE_API_KEY)}`,
    {
      context: {
        client: { clientName, clientVersion, hl: "en", gl: "US", ...extras },
        thirdParty: { embedUrl: "https://www.youtube.com" },
      },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    },
    { params: { prettyPrint: false } }
  );
  return data;
};

const tryClients = async (videoId) => {
  for (const profile of PLAYER_CLIENTS) {
    let data = null;
    try {
      data = await readPlayer(videoId, profile);
    } catch {
      continue;
    }
    const status = (data?.playabilityStatus || {}).status;
    if (status !== "OK") continue;
    const stream = pickBestAudio((data.streamingData || {}).adaptiveFormats);
    if (!stream) continue;
    const length = Number(data?.videoDetails?.lengthSeconds || 0);
    return { ...stream, duration: length > 0 ? length : 0 };
  }
  return null;
};

const getAudioStreamForVideo = (videoId) => {
  const vid = String(videoId || "").trim();
  if (!vid) return Promise.resolve(null);
  return memoize(makeCacheKey("yt:stream", { videoId: vid }), STREAM_TTL, () => tryClients(vid));
};

module.exports = { getAudioStreamForVideo, pickBestAudio, PLAYER_CLIENTS };