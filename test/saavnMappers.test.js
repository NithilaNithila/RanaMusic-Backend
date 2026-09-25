const { test } = require("node:test");
const assert = require("node:assert");
const { normalizeTrack, normalizeAlbum, normalizeArtist, normalizePlaylist, getImage, getDownloadUrl, getPrimaryArtist } = require("../src/services/saavn.mappers");

test("getImage accepts valid URL shapes and skips invalid candidates", () => {
  const small = "https://c.saavncdn.com/small.jpg";
  const large = "https://c.saavncdn.com/large.jpg";
  const images = [
    { quality: "50x50", url: small },
    { quality: "500x500", url: large },
  ];
  assert.strictEqual(getImage(images, "500x500"), large);
  assert.strictEqual(getImage(images, "150x150"), large);
  assert.strictEqual(getImage(large), large);
  assert.strictEqual(getImage({ url: large }), large);
  assert.strictEqual(getImage([small, large]), large);
  assert.strictEqual(
    getImage([
      { quality: "500x500", url: "<!doctype html><title>500</title>" },
      { quality: "150x150", url: small },
    ]),
    small
  );
  assert.strictEqual(
    getImage("https://c.saavncdn.com/editorial/logo/cover_500x500.jpg"),
    "https://c.saavncdn.com/editorial/cover_500x500.jpg"
  );
  assert.strictEqual(getImage("<!doctype html><title>500</title>"), "");
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
    image: [{ quality: "500x500", url: "https://c.saavncdn.com/song.jpg" }],
    downloadUrl: [{ quality: "320kbps", url: "audio" }],
    duration: 200,
    hasLyrics: true,
  });
  assert.strictEqual(out.id, "t1");
  assert.strictEqual(out.artist_name, "Artist");
  assert.strictEqual(out.image, "https://c.saavncdn.com/song.jpg");
  assert.strictEqual(out.audio, "audio");
  assert.strictEqual(out.type, "track");
  assert.strictEqual(out.has_lyrics, true);
});

test("normalizeAlbum rejects entries without ids or names", () => {
  assert.strictEqual(normalizeAlbum(null), null);
  assert.strictEqual(normalizeAlbum({ name: "Album" }), null);
  assert.strictEqual(normalizeAlbum({ id: "al1" }), null);
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

test("normalizePlaylist uses a direct image or the first valid song image", () => {
  const direct = normalizePlaylist({
    id: "p1",
    name: "Playlist",
    image: "https://c.saavncdn.com/playlist.jpg",
  });
  const fallback = normalizePlaylist({
    id: "p2",
    name: "Playlist",
    image: [{ quality: "500x500", url: "<!doctype html><title>500</title>" }],
    songs: [
      { id: "t1", name: "Track", image: [] },
      {
        id: "t2",
        name: "Track",
        image: [{ quality: "500x500", url: "https://c.saavncdn.com/track.jpg" }],
      },
    ],
  });
  const missing = normalizePlaylist({
    id: "p3",
    name: "Playlist",
    image: "<!doctype html><title>500</title>",
  });

  assert.strictEqual(direct.image, "https://c.saavncdn.com/playlist.jpg");
  assert.strictEqual(fallback.image, "https://c.saavncdn.com/track.jpg");
  assert.strictEqual(missing.image, "");
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

