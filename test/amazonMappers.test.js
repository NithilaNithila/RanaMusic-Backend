const { test } = require("node:test");
const assert = require("node:assert");
const {
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
} = require("../src/services/amazon.mappers");

test("normalizeTrack maps a full track", () => {
  const out = normalizeTrack({
    id: "t1",
    title: "Song",
    artist: { id: "a1", name: "A" },
    album: { id: "al", name: "Album" },
    image: "img",
    duration: 200,
  });
  assert.strictEqual(out.id, "t1");
  assert.strictEqual(out.source, "amazon");
  assert.strictEqual(out.artist_name, "A");
  assert.strictEqual(out.album_name, "Album");
  assert.strictEqual(out.duration, 200);
});

test("normalizeTrack nulls a track with no id", () => {
  assert.strictEqual(normalizeTrack({ title: "no id" }), null);
  assert.strictEqual(normalizeTrack(), null);
});

test("normalizeAlbum maps artist/year and its songs", () => {
  const out = normalizeAlbum({
    id: "al1",
    name: "Album",
    artist: { name: "A" },
    releaseDate: "2021-03-03",
    totalSongs: 1,
    songs: [{ id: "t1", title: "X" }],
  });
  assert.strictEqual(out.id, "al1");
  assert.strictEqual(out.artist_name, "A");
  assert.strictEqual(out.year, "2021");
  assert.strictEqual(out.songs[0].album_id, "al1");
  assert.strictEqual(normalizeAlbum({ name: "no id" }), null);
});

test("normalizeArtist maps name/url and nulls without id", () => {
  const out = normalizeArtist({ id: "ar", name: "A", url: "u" });
  assert.strictEqual(out.id, "ar");
  assert.strictEqual(out.name, "A");
  assert.strictEqual(normalizeArtist({ name: "no id" }), null);
  assert.strictEqual(normalizeArtist(null), null);
});

test("normalizePlaylist maps createdBy and songs", () => {
  const out = normalizePlaylist({ id: "pl", name: "P", createdBy: "O", songs: [{ id: "t1" }] });
  assert.strictEqual(out.id, "pl");
  assert.strictEqual(out.owner.name, "O");
  assert.strictEqual(out.track_count, 1);
  assert.strictEqual(normalizePlaylist({ name: "no id" }), null);
});
