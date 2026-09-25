const { test, afterEach, beforeEach } = require("node:test");
const assert = require("node:assert");
const axiosMock = require("./helpers/mockAxios");
const { getCache, cache } = require("../src/services/cache.service");

let saavn;

beforeEach(() => {
  cache.flushAll();
  axiosMock.reset();
  axiosMock.install();
  saavn = axiosMock.fresh("../src/services/saavn.service");
});

afterEach(() => {
  axiosMock.restore();
});

const songData = {
  results: [
    {
      id: "t1",
      name: "Song",
      artists: { primary: [{ id: "a1", name: "Artist" }], featured: [] },
      image: [],
      downloadUrl: [{ quality: "320kbps", url: "audio" }],
    },
  ],
  total: 1,
};

test("searchTracks maps results and returns total", async () => {
  axiosMock.setHandler((path, config) => {
    assert.match(path, /search\/songs/);
    assert.strictEqual(config.params.query, "arijit");
    return Promise.resolve({ data: { data: songData } });
  });
  const out = await saavn.searchTracks("arijit", { page: 0, limit: 10 });
  assert.strictEqual(out.total, 1);
  assert.strictEqual(out.results.length, 1);
  assert.strictEqual(out.results[0].id, "t1");
});

test("searchTracks falls back to JioSaavn on 429 upstream", async () => {
  let calls = 0;
  axiosMock.setHandler(() => {
    calls += 1;
    if (calls <= 3) return Promise.reject(Object.assign(new Error("rl"), { isAxiosError: true, response: { status: 429 } }));
    return Promise.resolve({ data: { results: [{ id: "j1", song: "J", primary_artists: "A", album: "Al" }] } });
  });
  const out = await saavn.searchTracks("q", {});
  assert.strictEqual(out.results[0].id, "j1");
});

test("searchTracks falls back to JioSaavn on any 5xx upstream", async () => {
  let calls = 0;
  axiosMock.setHandler(() => {
    calls += 1;
    if (calls <= 3) return Promise.reject(Object.assign(new Error("gw"), { isAxiosError: true, response: { status: 502 } }));
    return Promise.resolve({ data: { results: [{ id: "j2", song: "J2", primary_artists: "A", album: "Al" }] } });
  });
  const out = await saavn.searchTracks("q", {});
  assert.strictEqual(out.results[0].id, "j2");
});

test("searchAlbums maps results", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: { results: [{ id: "al", name: "A", artists: { primary: [] }, image: [{ quality: "500x500", url: "http://img" }] }], total: 1 } } }));
  const out = await saavn.searchAlbums("q", {});
  assert.strictEqual(out.results[0].id, "al");
});

test("searchAlbums drops entries without ids", async () => {
  axiosMock.setHandler(() =>
    Promise.resolve({
      data: {
        data: {
          results: [
            { id: "al", name: "A", image: [{ quality: "500x500", url: "http://img" }] },
            null,
            { name: "Missing ID", image: [{ quality: "500x500", url: "http://img" }] },
          ],
          total: 3,
        },
      },
    })
  );
  const out = await saavn.searchAlbums("q", {});
  assert.deepStrictEqual(out.results.map((album) => album.id), ["al"]);
});

test("searchArtists maps results", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: { results: [{ id: "ar", name: "A" }], total: 1 } } }));
  const out = await saavn.searchArtists("q", {});
  assert.strictEqual(out.results[0].id, "ar");
});

test("searchPlaylists returns empty list on upstream failure", async () => {
  axiosMock.fail(500);
  const out = await saavn.searchPlaylists("q", {});
  assert.deepStrictEqual(out, { total: 0, results: [] });
});

test("getTrackById normalizes the first song", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: [songData.results[0]] } }));
  const out = await saavn.getTrackById("t1");
  assert.strictEqual(out.id, "t1");
});

test("getTracks maps multiple tracks from a single ids call", async () => {
  axiosMock.setHandler((path, config) => {
    assert.match(path, /\/songs$/);
    assert.strictEqual(config.params.ids, "t1,t2");
    return Promise.resolve({ data: { data: [songData.results[0], { ...songData.results[0], id: "t2" }] } });
  });
  const out = await saavn.getTracks("t1,t2");
  assert.strictEqual(out.total, 2);
  assert.deepStrictEqual(out.results.map((r) => r.id), ["t1", "t2"]);
});

test("getTracks returns empty for no ids", async () => {
  const out = await saavn.getTracks("");
  assert.deepStrictEqual(out, { total: 0, results: [] });
});

test("getTracks recovers via per-id getTrackById when the collection call fails", async () => {
  let calls = 0;
  axiosMock.setHandler(() => {
    calls += 1;
    if (calls <= 3) return Promise.reject(Object.assign(new Error("rl"), { isAxiosError: true, response: { status: 429 } }));
    return Promise.resolve({ data: { data: [songData.results[0]] } });
  });
  const out = await saavn.getTracks("t1");
  assert.strictEqual(out.total, 1);
  assert.strictEqual(out.results[0].id, "t1");
});

test("getTrackSuggestions maps suggestion tracks", async () => {
  axiosMock.setHandler((path) => {
    assert.match(path, /\/songs\/t1\/suggestions$/);
    return Promise.resolve({ data: { data: [songData.results[0], { ...songData.results[0], id: "t2" }] } });
  });
  const out = await saavn.getTrackSuggestions("t1");
  assert.strictEqual(out.total, 2);
  assert.strictEqual(out.results[0].id, "t1");
});

test("getAlbums fetches each album by id", async () => {
  axiosMock.setHandler((path, config) => {
    assert.match(path, /\/albums$/);
    return Promise.resolve({ data: { data: { id: config.params.id, name: "Album", artists: { primary: [] }, image: [] } } });
  });
  const out = await saavn.getAlbums("al1,al2");
  assert.strictEqual(out.total, 2);
  assert.deepStrictEqual(out.results.map((r) => r.id).sort(), ["al1", "al2"]);
});

test("getArtists fetches each artist by id", async () => {
  axiosMock.setHandler((path, config) => {
    assert.match(path, /\/artists$/);
    return Promise.resolve({ data: { data: { id: config.params.id, name: "A", image: [] } } });
  });
  const out = await saavn.getArtists("ar1,ar2");
  assert.strictEqual(out.total, 2);
  assert.deepStrictEqual(out.results.map((r) => r.id).sort(), ["ar1", "ar2"]);
});

test("getPlaylistById normalizes playlist detail including songs", async () => {
  axiosMock.setHandler((path, config) => {
    assert.match(path, /\/playlists$/);
    assert.strictEqual(config.params.id, "p1");
    return Promise.resolve({ data: { data: { id: "p1", name: "P", image: [], songCount: 3, songs: [songData.results[0]] } } });
  });
  const out = await saavn.getPlaylistById("p1");
  assert.strictEqual(out.id, "p1");
  assert.strictEqual(out.track_count, 3);
  assert.strictEqual(out.songs.length, 1);
});

test("getPlaylistById resolves null for invalid entity", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: { id: "", name: "" } } }));
  const out = await saavn.getPlaylistById("bad");
  assert.strictEqual(out, null);
});

test("getPlaylists skips invalid playlists", async () => {
  let call = 0;
  axiosMock.setHandler((path, config) => {
    call += 1;
    if (call === 1) return Promise.resolve({ data: { data: { id: config.params.id, name: "P", image: [] } } });
    return Promise.resolve({ data: { data: { id: "", name: "" } } });
  });
  const out = await saavn.getPlaylists("p1,bad");
  assert.strictEqual(out.total, 1);
  assert.strictEqual(out.results[0].id, "p1");
});

test("getTrackById resolves null for invalid entity", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: [{ id: "", name: "" }] } }));
  const out = await saavn.getTrackById("bad");
  assert.strictEqual(out, null);
});

test("getTrackById returns null when no songs", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: [] } }));
  const out = await saavn.getTrackById("none");
  assert.strictEqual(out, null);
});

test("getAlbumById normalizes album data", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: { id: "al", name: "A", artists: { primary: [{ name: "X" }] } } } }));
  const out = await saavn.getAlbumById("al");
  assert.strictEqual(out.id, "al");
});

test("getArtistById normalizes artist data", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: { id: "ar", name: "A" } } }));
  const out = await saavn.getArtistById("ar");
  assert.strictEqual(out.id, "ar");
});

test("getArtistSongs maps artist songs", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: { songs: songData.results, total: 1 } } }));
  const out = await saavn.getArtistSongs("ar");
  assert.strictEqual(out.results[0].id, "t1");
});

test("getArtistAlbums maps valid artist albums", async () => {
  axiosMock.setHandler(() =>
    Promise.resolve({
      data: {
        data: {
          albums: [
            { id: "al", name: "A", artists: { primary: [] } },
            { name: "Missing ID", artists: { primary: [] } },
          ],
          total: 2,
        },
      },
    })
  );
  const out = await saavn.getArtistAlbums("ar");
  assert.deepStrictEqual(out.results.map((album) => album.id), ["al"]);
});

test("getLyrics returns lyrics", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: { lyrics: "la la" } } }));
  const out = await saavn.getLyrics("t1");
  assert.strictEqual(out, "la la");
});

test("getLyrics 404 falls back to JioSaavn", async () => {
  let calls = 0;
  axiosMock.setHandler((path) => {
    calls += 1;
    if (calls === 1 && path.includes("/lyrics")) {
      return Promise.reject(Object.assign(new Error("nf"), { isAxiosError: true, response: { status: 404 } }));
    }
    return Promise.resolve({ data: { lyrics: "from jiosaavn" } });
  });
  const out = await saavn.getLyrics("t1");
  assert.strictEqual(out, "from jiosaavn");
});

test("getLyrics returns null when upstream has none", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: { data: { lyrics: null } } }));
  const out = await saavn.getLyrics("t1");
  assert.strictEqual(out, null);
});

test("getLyricsByTitle finds lyrics by fuzzy match", async () => {
  let lyricsCalls = 0;
  axiosMock.setHandler((path) => {
    if (path.includes("/search/songs")) {
      return Promise.resolve({
        data: {
          data: {
            results: [{ id: "t1", lyricsId: "L1", name: "Song Title", artists: { primary: [{ name: "Artist" }] }, image: [], downloadUrl: [] }],
            total: 1,
          },
        },
      });
    }
    if (path.includes("/lyrics")) {
      lyricsCalls += 1;
      return Promise.resolve({ data: { data: { lyrics: "lyrics!" } } });
    }
    return Promise.resolve({ data: {} });
  });
  const out = await saavn.getLyricsByTitle("Artist", "song title");
  assert.strictEqual(out, "lyrics!");
  assert.ok(lyricsCalls >= 1);
});

test("getLyricsByTitle returns null when no candidate matches", async () => {
  axiosMock.setHandler((path) => {
    if (path.includes("/search/songs")) {
      return Promise.resolve({ data: { data: { results: [{ id: "x", name: "Totally Different", artists: { primary: [] } }], total: 1 } } });
    }
    return Promise.resolve({ data: { data: { lyrics: "x" } } });
  });
  const out = await saavn.getLyricsByTitle("Artist", "No Match Here");
  assert.strictEqual(out, null);
});

test("getLyricsByTitle skips a candidate whose lyrics fetch is unavailable", async () => {
  let lyricsStatus = 0;
  axiosMock.setHandler((path) => {
    if (path.includes("/search/songs")) {
      return Promise.resolve({
        data: {
          data: {
            results: [
              { id: "t1", lyricsId: "L1", name: "Song Title", artists: { primary: [{ name: "Artist" }] }, image: [], downloadUrl: [] },
              { id: "t2", lyricsId: "L2", name: "Song Title", artists: { primary: [{ name: "Artist" }] }, image: [], downloadUrl: [] },
            ],
            total: 2,
          },
        },
      });
    }
    if (path.includes("/lyrics")) {
      lyricsStatus += 1;
      if (lyricsStatus === 1) {
        const err = Object.assign(new Error("ho"), { isAxiosError: true, response: { status: 500, data: {} } });
        return Promise.reject(err);
      }
      return Promise.resolve({ data: { data: { lyrics: "second one!" } } });
    }
    return Promise.resolve({ data: {} });
  });
  const out = await saavn.getLyricsByTitle("Artist", "song title");
  assert.strictEqual(out, "second one!");
});

test("getLyricsByTitle matches on a partial artist name", async () => {
  axiosMock.setHandler((path) => {
    if (path.includes("/search/songs")) {
      return Promise.resolve({
        data: {
          data: {
            results: [{ id: "t1", lyricsId: "L1", name: "Song Title", artist_name: "Artist feat. XYZ", image: [], downloadUrl: [] }],
            total: 1,
          },
        },
      });
    }
    if (path.includes("/lyrics")) return Promise.resolve({ data: { data: { lyrics: "partial!" } } });
    return Promise.resolve({ data: {} });
  });
  const out = await saavn.getLyricsByTitle("Artist", "song title");
  assert.strictEqual(out, "partial!");
});

test("re-throws non-fallback errors from the proxy", async () => {
  axiosMock.setHandler(() => Promise.reject(Object.assign(new Error("bad req"), { isAxiosError: true, response: { status: 400 } })));
  await assert.rejects(saavn.searchTracks("q", {}), /bad req/);
});
