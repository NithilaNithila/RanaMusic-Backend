const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const axiosMock = require("./helpers/mockAxios");
const { cache } = require("../src/services/cache.service");

let stream;
const audioFormat = (url, bitrate, mime = "audio/webm", itag = 140) => ({
  mimeType: mime,
  bitrate,
  url,
  itag,
});
const okResponse = (formats, length = 200) => ({
  playabilityStatus: { status: "OK" },
  streamingData: { adaptiveFormats: formats },
  videoDetails: { lengthSeconds: String(length) },
});

beforeEach(() => {
  cache.flushAll();
  axiosMock.reset();
  axiosMock.install();
  axiosMock.fresh("../src/services/youtubeStream.service");
  delete require.cache[require.resolve("../src/services/youtubeStream.service")];
  stream = require("../src/services/youtubeStream.service");
});

afterEach(() => {
  axiosMock.restore();
});

test("pickBestAudio returns null for empty/missing/non-audio input", () => {
  assert.strictEqual(stream.pickBestAudio(undefined), null);
  assert.strictEqual(stream.pickBestAudio([]), null);
  assert.strictEqual(stream.pickBestAudio("nope"), null);
  assert.strictEqual(stream.pickBestAudio([{ mimeType: "video/mp4", url: "http://x" }]), null);
});

test("pickBestAudio picks the highest-bitrate audio-only format with an http url", () => {
  const formats = [
    { mimeType: "audio/webm; codecs=opus", bitrate: 48000, url: "https://s1", itag: 140 },
    { mimeType: "audio/mp4", bitrate: 128000, url: "https://s2", itag: 141 },
    { mimeType: "audio/webm; codecs=opus", bitrate: 48000, url: null, itag: 140 },
    { mimeType: "video/mp4", bitrate: 9000000, url: "https://v", itag: 18 },
    { mimeType: "audio/webm; codecs=opus", bitrate: 48000, url: "//protocol-relative", itag: 140 },
  ];
  const best = stream.pickBestAudio(formats);
  assert.strictEqual(best.audio, "https://s2");
  assert.strictEqual(best.mimeType, "audio/mp4");
  assert.strictEqual(best.bitrate, 128000);
  assert.strictEqual(best.itag, 141);
});

test("getAudioStreamForVideo returns null for an empty/missing videoId", async () => {
  assert.strictEqual(await stream.getAudioStreamForVideo(""), null);
  assert.strictEqual(await stream.getAudioStreamForVideo(undefined), null);
});

test("getAudioStreamForVideo extracts the best audio stream from an OK ANDROID response", async () => {
  axiosMock.setHandler(() =>
    Promise.resolve({
      data: okResponse([audioFormat("https://s1", 48000), audioFormat("https://s2", 128000, "audio/mp4", 141)]),
    })
  );
  const out = await stream.getAudioStreamForVideo("vid1");
  assert.strictEqual(out.audio, "https://s2");
  assert.strictEqual(out.mimeType, "audio/mp4");
  assert.strictEqual(out.duration, 200);
});

test("getAudioStreamForVideo caches extraction for the same videoId", async () => {
  let calls = 0;
  axiosMock.setHandler(() => {
    calls += 1;
    return Promise.resolve({ data: okResponse([audioFormat("https://s", 48000)]) });
  });
  const first = await stream.getAudioStreamForVideo("vid2");
  const second = await stream.getAudioStreamForVideo("vid2");
  assert.strictEqual(first.audio, "https://s");
  assert.strictEqual(second.audio, "https://s");
  assert.strictEqual(calls, 1);
});

test("getAudioStreamForVideo returns null on network failures across all clients", async () => {
  axiosMock.fail(500, "boom");
  assert.strictEqual(await stream.getAudioStreamForVideo("vid3"), null);
});

test("getAudioStreamForVideo returns null when playability is not OK (bot-check)", async () => {
  axiosMock.respond({ playabilityStatus: { status: "LOGIN_REQUIRED" }, streamingData: {} });
  assert.strictEqual(await stream.getAudioStreamForVideo("vid4"), null);
});

test("getAudioStreamForVideo returns null when no playable audio-only format exists", async () => {
  axiosMock.respond({
    playabilityStatus: { status: "OK" },
    streamingData: { adaptiveFormats: [{ mimeType: "video/mp4", url: "https://v" }] },
  });
  assert.strictEqual(await stream.getAudioStreamForVideo("vid5"), null);
});

test("getAudioStreamForVideo carries the video length into duration", async () => {
  axiosMock.setHandler(() =>
    Promise.resolve({ data: okResponse([audioFormat("https://s", 48000)], 314) })
  );
  const out = await stream.getAudioStreamForVideo("vid6");
  assert.strictEqual(out.duration, 314);
  assert.strictEqual(out.audio, "https://s");
});