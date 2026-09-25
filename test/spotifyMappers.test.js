const { test } = require("node:test");
const assert = require("node:assert");
const {
  normalizeTrack,
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
} = require("../src/services/spotify.mappers");

const base = {
  id: "t1",
  title: "Song",
  artists: [{ name: "A" }, "B", { name: "" }],
  duration_ms: 200000,
  release_date: "2021-06-01",
};

test("normalizeTrack maps a full track", () => {
  const out = normalizeTrack(base);
  assert.strictEqual(out.id, "t1");
  assert.strictEqual(out.source, "spotify");
  assert.strictEqual(out.artist_name, "A, B");
  assert.strictEqual(out.duration, 200);
  assert.strictEqual(out.year, "2021");
  assert.deepStrictEqual(out.artists.primary, [{ id: "", name: "A" }, { id: "", name: "B" }]);
});

test("normalizeTrack nulls tracks with no id and no uri", () => {
  assert.strictEqual(normalizeTrack({}), null);
  assert.strictEqual(normalizeTrack(null), null);
});

test("normalizeTrack derives id from uri and uses name/album fields", () => {
  const out = normalizeTrack({ uri: "spotify:track:xyz", name: "N", album: "AL", artist: "Solo" });
  assert.strictEqual(out.id, "xyz");
  assert.strictEqual(out.name, "N");
  assert.strictEqual(out.album_name, "AL");
  assert.strictEqual(out.artist_name, "Solo");
});

test("normalizeTrack parses a duration string fallback", () => {
  const out = normalizeTrack({ id: "a", duration: "3:05" });
  assert.strictEqual(out.duration, 185);
});

test("normalizeTrack returns 0 duration on garbage", () => {
  const out = normalizeTrack({ id: "a", duration: "abc" });
  assert.strictEqual(out.duration, 0);
});

test("normalizeAlbum maps album plus its tracks", () => {
  const out = normalizeAlbum({
    id: "al1",
    name: "Album",
    artists: [{ name: "A" }],
    release_date: "2020",
    total_tracks: 1,
    tracks: [{ id: "t1", name: "X" }],
  });
  assert.strictEqual(out.id, "al1");
  assert.strictEqual(out.source, "spotify");
  assert.strictEqual(out.song_count, 1);
  assert.strictEqual(out.songs[0].album_id, "al1");
  assert.strictEqual(out.songs[0].album_name, "Album");
});

test("normalizeAlbum nulls an album with no id", () => {
  assert.strictEqual(normalizeAlbum({ name: "NoId" }), null);
  assert.strictEqual(normalizeAlbum(null), null);
});

test("normalizeArtist maps genres/followers and nulls without id", () => {
  const out = normalizeArtist({ id: "ar1", name: "Artist", genres: ["pop", "rock"], followers: 5, popularity: 80 });
  assert.strictEqual(out.id, "ar1");
  assert.strictEqual(out.role, "pop, rock");
  assert.strictEqual(out.followers, 5);
  assert.deepStrictEqual(out.genres, ["pop", "rock"]);
  assert.strictEqual(normalizeArtist({ name: "no id" }), null);
  assert.strictEqual(normalizeArtist(null), null);
});

test("normalizePlaylist maps owner/tracks and nulls without id", () => {
  const out = normalizePlaylist({
    id: "p1",
    name: "P",
    owner_id: "u1",
    owner: "Owner",
    tracks: [{ id: "t1", name: "X" }, { id: "t2", name: "Y" }],
  });
  assert.strictEqual(out.id, "p1");
  assert.strictEqual(out.owner.id, "u1");
  assert.strictEqual(out.owner.name, "Owner");
  assert.strictEqual(out.track_count, 2);
  assert.strictEqual(out.songs.length, 2);
  assert.strictEqual(normalizePlaylist({ name: "no id" }), null);
  assert.strictEqual(normalizePlaylist(null), null);
});
