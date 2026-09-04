const { test } = require("node:test");
const assert = require("node:assert");
const {
  getImage,
  parseDuration,
  parseCount,
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
} = require("../src/services/ytmusic.mappers");

test("getImage returns first (largest) thumbnail or empty", () => {
  assert.strictEqual(getImage([{ url: "a" }, { url: "b" }]), "a");
  assert.strictEqual(getImage([]), "");
  assert.strictEqual(getImage(null), "");
});

test("parseDuration handles strings and garbage", () => {
  assert.strictEqual(parseDuration("1:02"), 62);
  assert.strictEqual(parseDuration(""), 0);
  assert.strictEqual(parseDuration("ab:cd"), 0);
  assert.strictEqual(parseDuration(undefined), 0);
});

test("parseCount handles raw K/M/B and numbers", () => {
  assert.strictEqual(parseCount("1.5M"), 1500000);
  assert.strictEqual(parseCount("2K"), 2000);
  assert.strictEqual(parseCount("1B"), 1000000000);
  assert.strictEqual(parseCount("1,234"), 1234);
  assert.strictEqual(parseCount(500), 500);
  assert.strictEqual(parseCount(0), 0);
  assert.strictEqual(parseCount("abc"), 0);
  assert.strictEqual(parseCount(undefined), 0);
});

test("normalizeTrack maps a full track and builds watch url", () => {
  const out = normalizeTrack({
    videoId: "v1",
    title: "Song",
    artists: [{ name: "A" }, { name: "B" }],
    album: { id: "al", name: "Album" },
    thumbnails: [{ url: "img" }],
    duration_seconds: 200,
    views: "1M",
    year: "2022",
    has_lyrics: true,
    isExplicit: 1,
  });
  assert.strictEqual(out.id, "v1");
  assert.strictEqual(out.source, "ytmusic");
  assert.strictEqual(out.artist_name, "A, B");
  assert.strictEqual(out.url, "https://music.youtube.com/watch?v=v1");
  assert.strictEqual(out.play_count, 1000000);
  assert.strictEqual(out.has_lyrics, true);
  assert.strictEqual(out.isExplicit, true);
});

test("normalizeTrack handles string album and duration_ms", () => {
  const out = normalizeTrack({ videoId: "v", title: "T", album: "StringAlbum", duration_ms: 90000 });
  assert.strictEqual(out.album_name, "StringAlbum");
  assert.strictEqual(out.duration, 90);
});

test("normalizeTrack nulls tracks without videoId", () => {
  assert.strictEqual(normalizeTrack({ title: "none" }), null);
  assert.strictEqual(normalizeTrack(), null);
});

test("normalizeAlbum maps album with idOverride and nulls without id/tracks", () => {
  const out = normalizeAlbum({ browseId: "al", title: "Album", artists: [{ name: "A" }], tracks: [{ videoId: "t1", title: "X" }] });
  assert.strictEqual(out.id, "al");
  assert.strictEqual(out.song_count, 1);
  assert.strictEqual(out.songs[0].id, "t1");
  assert.strictEqual(normalizeAlbum({ title: "no id no tracks" }), null);
  assert.strictEqual(normalizeAlbum(null), null);
});

test("normalizeAlbum idOverride wins and tracks keep album context", () => {
  const out = normalizeAlbum({ artists: [{ name: "A" }], tracks: [{ videoId: "t1", title: "X" }] }, "override");
  assert.strictEqual(out.id, "override");
  assert.strictEqual(out.songs[0].album_id, "override");
});

test("normalizeArtist maps channel and nulls without an id", () => {
  const out = normalizeArtist({ channelId: "ch", name: "A", subscribers: "2K", genres: ["pop"] });
  assert.strictEqual(out.id, "ch");
  assert.strictEqual(out.url, "https://music.youtube.com/channel/ch");
  assert.strictEqual(out.followers, 2000);
  assert.strictEqual(normalizeArtist({ name: "no id" }), null);
});

test("normalizePlaylist maps owner/songs and nulls without id", () => {
  const out = normalizePlaylist({ playlistId: "pl", title: "P", author: { id: "u", name: "O" }, tracks: [{ videoId: "t1" }] });
  assert.strictEqual(out.id, "pl");
  assert.strictEqual(out.owner.name, "O");
  assert.strictEqual(out.url, "https://music.youtube.com/playlist?list=pl");
  assert.strictEqual(out.songs.length, 1);
  assert.strictEqual(normalizePlaylist({ title: "no id" }), null);
});
