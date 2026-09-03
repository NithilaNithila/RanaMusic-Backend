const { test } = require("node:test");
const assert = require("node:assert");
const { normalizeTrack, normalizeAlbum, normalizeArtist, normalizePlaylist, getImage, getDownloadUrl, getPrimaryArtist } = require("../src/services/saavn.mappers");

test("getImage picks requested quality or falls back to last", () => {
  const images = [{ quality: "50x50", url: "a" }, { quality: "500x500", url: "b" }];
  assert.strictEqual(getImage(images, "500x500"), "b");
  assert.strictEqual(getImage(images, "150x150"), "b"); // no match -> last
  assert.strictEqual(getImage([], "500x500"), "");
  assert.strictEqual(getImage(null, "500x500"), "");
});

test("getDownloadUrl picks quality or falls back to last", () => {
  const urls = [{ quality: "96kbps", url: "x" }, { quality: "320kbps", url: "y" }];
  assert.strictEqual(getDownloadUrl(urls, "320kbps"), "y");
  assert.strictEqual(getDownloadUrl(urls, "12kbps"), "y");
});

test("normalizeTrack flattens the unified shape", () => {
  const out = normalizeTrack({
    id: "t1",
    name: "Song",
    artists: { primary: [{ id: "a1", name: "Artist" }], featured: [] },
    album: { id: "al1", name: "Album" },
    image: [{ quality: "500x500", url: "img" }],
    downloadUrl: [{ quality: "320kbps", url: "audio" }],
    duration: 200,
    hasLyrics: true,
  });
  assert.strictEqual(out.id, "t1");
  assert.strictEqual(out.artist_name, "Artist");
  assert.strictEqual(out.image, "img");
  assert.strictEqual(out.audio, "audio");
  assert.strictEqual(out.type, "track");
  assert.strictEqual(out.has_lyrics, true);
});

test("normalizeAlbum maps songs to normalized tracks", () => {
  const out = normalizeAlbum({
    id: "al1",
    name: "Album",
    artists: { primary: [{ id: "a1", name: "Artist" }], featured: [] },
    image: [{ quality: "500x500", url: "img" }],
    songCount: 1,
    songs: [{ id: "t1", name: "S", artists: { primary: [{ id: "a1", name: "Artist" }], featured: [] }, image: [{ quality: "500x500", url: "i" }] }],
  });
  assert.strictEqual(out.artist_name, "Artist");
  assert.strictEqual(out.song_count, 1);
  assert.strictEqual(out.songs[0].id, "t1");
});

test("normalizeArtist maps counts", () => {
  const out = normalizeArtist({ id: "a1", name: "Artist", image: [], role: "Singer" });
  assert.strictEqual(out.type, "artist");
  assert.strictEqual(out.song_count, 0);
});

test("normalizePlaylist maps name and cache info", () => {
  const out = normalizePlaylist({ id: "p1", name: "Playlist", image: [], url: "u", songCount: 8 });
  assert.strictEqual(out.track_count, 8);
  assert.strictEqual(out.type, "playlist");
});

test("normalizeTrack maps featured artists and totalSongs fallback", () => {
  const out = normalizeTrack({
    id: "t1",
    name: "S",
    artists: { primary: [{ id: "a1", name: "A", image: [], url: "u" }], featured: [{ id: "f1", name: "Feat" }] },
    image: [],
    downloadUrl: [],
    album: { id: "al", name: "Al" },
    playCount: 10,
    label: "L",
    copyright: "C",
  });
  assert.deepStrictEqual(out.artists.featured, [{ id: "f1", name: "Feat", image: "", url: "" }]);
  assert.strictEqual(out.artists.primary[0].image, "");
});

test("getPrimaryArtist joins primary names and drops blanks", () => {
  assert.strictEqual(getPrimaryArtist({ primary: [{ name: "A" }, { name: " B " }, { name: "" }] }), "A, B");
  assert.strictEqual(getPrimaryArtist({ primary: [] }), "");
  assert.strictEqual(getPrimaryArtist({}), "");
  assert.strictEqual(getPrimaryArtist(null), "");

  const track = normalizeTrack({ id: "t", name: "S", artists: {} });
  assert.strictEqual(track.artist_name, "");
  assert.strictEqual(track.artists.primary.length, 0);
});

test("normalizeArtist counts via songs/albums collections", () => {
  // songs/albums as arrays
  const arr = normalizeArtist({ id: "a", name: "A", topSongs: [1, 2], topAlbums: [1] });
  assert.strictEqual(arr.song_count, 2);
  assert.strictEqual(arr.album_count, 1);
  // songs/albums as { songs:[...] } / { albums:[...] } objects
  const obj = normalizeArtist({ id: "a2", name: "A2", topSongs: { songs: [1, 2, 3] }, topAlbums: { albums: [1] } });
  assert.strictEqual(obj.song_count, 3);
  assert.strictEqual(obj.album_count, 1);
});

