const { test, afterEach, beforeEach } = require("node:test");
const assert = require("node:assert");
const axiosMock = require("./helpers/mockAxios");
const { cache } = require("../src/services/cache.service");

let jiosaavn;

beforeEach(() => {
  cache.flushAll();
  axiosMock.reset();
  axiosMock.install();
  jiosaavn = axiosMock.fresh("../src/services/jiosaavn.service");
});

afterEach(() => {
  axiosMock.restore();
});

test("searchTracks maps results", async () => {
  axiosMock.setHandler((path, config) => {
    assert.strictEqual(config.params.__call, "search.getResults");
    return Promise.resolve({
      data: {
        total: 1,
        results: [{ id: "t1", song: "S", primary_artists: "A", duration: "200", play_count: "5", has_lyrics: "true", more_info: {} }],
      },
    });
  });
  const out = await jiosaavn.searchTracks("q", { page: 0, limit: 10 });
  assert.strictEqual(out.results[0].id, "t1");
  assert.strictEqual(out.results[0].has_lyrics, true);
});

test("searchAlbums maps results", async () => {
  axiosMock.setHandler(() =>
    Promise.resolve({ data: { total: 1, results: [{ albumid: "al", title: "A", primary_artists: "X" }] } })
  );
  const out = await jiosaavn.searchAlbums("q", {});
  assert.strictEqual(out.results[0].id, "al");
});

test("searchArtists maps results", async () => {
  axiosMock.setHandler(() =>
    Promise.resolve({ data: { total: 1, results: [{ id: "ar", name: "A" }] } })
  );
  const out = await jiosaavn.searchArtists("q", {});
  assert.strictEqual(out.results[0].id, "ar");
});

test("getTrackById returns first song or null", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { songs: [{ id: "t1", song: "S", primary_artists: "A" }] } }));
  assert.strictEqual((await jiosaavn.getTrackById("t1")).id, "t1");
  axiosMock.setHandler(() => Promise.resolve({ data: { songs: [] } }));
  assert.strictEqual(await jiosaavn.getTrackById("none"), null);
});

test("getAlbumById normalizes or nulls", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { id: "al", title: "A", primary_artists: "X" } }));
  assert.strictEqual((await jiosaavn.getAlbumById("al")).id, "al");
  axiosMock.setHandler(() => Promise.resolve({ data: null }));
  assert.strictEqual(await jiosaavn.getAlbumById("none"), null);
});

test("getArtistById normalizes or nulls", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { id: "ar", name: "A" } }));
  assert.strictEqual((await jiosaavn.getArtistById("ar")).id, "ar");
  axiosMock.setHandler(() => Promise.resolve({ data: null }));
  assert.strictEqual(await jiosaavn.getArtistById("none"), null);
});

test("getArtistSongs returns slice with total", async () => {
  axiosMock.setHandler(() =>
    Promise.resolve({ data: { topSongs: { total: 2, songs: [{ id: "t1", song: "S", primary_artists: "A" }, { id: "t2", song: "S2", primary_artists: "A" }] } } })
  );
  const out = await jiosaavn.getArtistSongs("ar", { limit: 1 });
  assert.strictEqual(out.results.length, 1);
  assert.strictEqual(out.total, 2);
});

test("getArtistAlbums returns slice", async () => {
  axiosMock.setHandler(() =>
    Promise.resolve({ data: { topAlbums: { total: 1, albums: [{ id: "al", title: "A", primary_artists: "X" }] } } })
  );
  const out = await jiosaavn.getArtistAlbums("ar");
  assert.strictEqual(out.results[0].id, "al");
});

test("getLyrics returns lyrics", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { lyrics: "la la" } }));
  assert.strictEqual(await jiosaavn.getLyrics("t1"), "la la");
});

test("getLyrics returns null on upstream failure", async () => {
  cache.flushAll();
  axiosMock.fail(500);
  assert.strictEqual(await jiosaavn.getLyrics("t1"), null);
});

test("getLyricsByTitle returns lyrics through fuzzy matching", async () => {
  axiosMock.setHandler((path, config) => {
    if (config.params.__call === "lyrics.getLyrics") {
      return Promise.resolve({ data: { lyrics: "the lyrics" } });
    }
    return Promise.resolve({
      data: {
        results: [{ id: "t1", song: "Song Title", primary_artists: "Artist", more_info: {} }],
      },
    });
  });
  const out = await jiosaavn.getLyricsByTitle("Artist", "song title");
  assert.strictEqual(out, "the lyrics");
});

test("getLyricsByTitle returns null when no match", async () => {
  axiosMock.setHandler(() =>
    Promise.resolve({ data: { results: [{ id: "t9", song: "Zzz", primary_artists: "Y", more_info: {} }] } })
  );
  const out = await jiosaavn.getLyricsByTitle("Artist", "no match");
  assert.strictEqual(out, null);
});

test("getLyricsByTitle handles upstream failure gracefully", async () => {
  axiosMock.fail(500);
  const out = await jiosaavn.getLyricsByTitle("Artist", "x");
  assert.strictEqual(out, null);
});

test("cached responses are returned without a network call", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { results: [{ id: "t1", song: "S", primary_artists: "A" }] } }));
  await jiosaavn.searchTracks("q", { page: 0, limit: 10 });
  let calls = 0;
  axiosMock.setHandler(() => {
    calls += 1;
    return Promise.resolve({ data: { results: [] } });
  });
  await jiosaavn.searchTracks("q", { page: 0, limit: 10 });
  assert.strictEqual(calls, 0);
});

test("getTrackById builds download links by decrypting the media URL", async () => {
  const forge = require("node-forge");
  const cipher = forge.cipher.createCipher("DES-ECB", forge.util.createBuffer("38346591"));
  cipher.start({ iv: forge.util.createBuffer("00000000") });
  cipher.update(forge.util.createBuffer("https://song.example/_96.mp3"));
  cipher.finish();
  const encrypted = forge.util.encode64(cipher.output.getBytes());

  axiosMock.setHandler(() =>
    Promise.resolve({
      data: {
        songs: [
          {
            id: "t1",
            song: "S",
            image: "https://img.example/150x150.jpg",
            encrypted_media_url: encrypted,
            more_info: {
              artistMap: {
                primary_artists: [{ id: "a1", name: "Artist One", image: "https://img.example/150x150.jpg", perma_url: "https://a.example" }],
              },
            },
          },
        ],
      },
    })
  );
  const track = await jiosaavn.getTrackById("t1");
  assert.ok(track.audio, "expected a decrypted audio url");
  // getTrackById returns the normalizeTrack shape, where image is the single
  // best match URL (string), not the raw array of per-quality links.
  assert.ok(typeof track.image === "string" && track.image.length > 0);
  assert.strictEqual(track.artists.primary[0].id, "a1");
});

test("getTrackById handles an undecryptable media url gracefully", async () => {
  axiosMock.setHandler(() =>
    Promise.resolve({
      data: {
        songs: [{ id: "t1", song: "S", encrypted_media_url: "!!!not-valid-base64!!!", image: "x" }],
      },
    })
  );
  const track = await jiosaavn.getTrackById("t1");
  // normalizeTrack returns audio as a string URL ("" when no URL could be
  // built). node-forge's decode64 is lenient and won't throw on the garbage
  // input, so the contract here is a well-formed normalized track that never
  // crashes — not a guaranteed-empty audio field.
  assert.ok(track, "expected a normalized track");
  assert.ok(typeof track.image === "string");
  assert.ok(typeof track.audio === "string");
});
