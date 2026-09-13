const { test, afterEach, beforeEach } = require("node:test");
const assert = require("node:assert");
const axiosMock = require("./helpers/mockAxios");
const { cache } = require("../src/services/cache.service");
const ytService = require("../src/services/ytmusic.service");

let searchService;

beforeEach(() => {
  cache.flushAll();
  axiosMock.reset();
  axiosMock.install();
  searchService = axiosMock.fresh("../src/services/search.service");
  // The ytmusic provider runs an in-process yt-dlp binary; it must not spawn
  // during fast unit tests. Default it to an empty stub — provider-specific
  // tests swap in their own fake.
  ytService.search = async (query, opts = {}) => ({
    total: 0,
    results: { track: [], album: [], artist: [], playlist: [] },
  });
});

afterEach(() => {
  axiosMock.restore();
});

// Distinguish providers by the URL path they hit:
//  - saavn: /search/songs, /search/albums, /search/artists
//  - spotify/amazon: /search (spotify), /search/playlists etc (amazon scraper)
const trackResult = (id) => ({ id, name: `Track ${id}`, artist_name: "Artist" });

test("resolveTypes returns defaults for all/absent and filters invalid", () => {
  assert.deepStrictEqual(searchService.resolveTypes(undefined), ["track", "album", "artist", "playlist"]);
  assert.deepStrictEqual(searchService.resolveTypes("all"), ["track", "album", "artist", "playlist"]);
  assert.deepStrictEqual(searchService.resolveTypes("track,album"), ["track", "album"]);
  assert.deepStrictEqual(searchService.resolveTypes("bogus"), ["track", "album", "artist", "playlist"]);
});

test("search merges and dedupes results across providers by key", async () => {
  axiosMock.setHandler((path) => {
    // saavn provider -> /search/songs-style path
    if (path.includes("/search/songs")) {
      return Promise.resolve({ data: { data: { results: [trackResult("a"), trackResult("b")], total: 2 } } });
    }
    // spotify -> /search
    if (path === "/search") {
      return Promise.resolve({ data: { results: [trackResult("b"), trackResult("c")] } });
    }
    // amazon -> /search/playlists handled elsewhere; default to empty.
    return Promise.resolve({ data: { data: { results: [] } } });
  });

  const out = await searchService.search("q", { type: "track", limit: 10 });
  assert.strictEqual(out.results.tracks.length, 3); // a, b (deduped), c
});

test("search collects all four result buckets when type is all", async () => {
  axiosMock.setHandler((path) => {
    if (path.includes("/search/songs")) return Promise.resolve({ data: { data: { results: [trackResult("t")], total: 1 } } });
    if (path.includes("/search/albums")) return Promise.resolve({ data: { data: { results: [{ id: "al", name: "Album", artist_name: "A" }], total: 1 } } });
    if (path.includes("/search/artists")) return Promise.resolve({ data: { data: { results: [{ id: "ar", name: "Artist" }], total: 1 } } });
    if (path === "/search") return Promise.resolve({ data: { results: [] } });
    if (path.includes("/search/playlists")) return Promise.resolve({ data: { data: { results: [{ id: "pl", name: "Playlist" }], total: 1 } } });
    return Promise.resolve({ data: { data: { results: [] } } });
  });

  const out = await searchService.search("q", { limit: 10 });
  assert.ok(Array.isArray(out.results.tracks));
  assert.ok(Array.isArray(out.results.albums));
  assert.ok(Array.isArray(out.results.artists));
  assert.ok(Array.isArray(out.results.playlists));
});

test("non-track rows are tagged with their provider source (album + playlist routing)", async () => {
  axiosMock.setHandler((path) => {
    if (path.includes("/search/albums")) {
      return Promise.resolve({ data: { data: { results: [{ id: "a1", name: "Saavn Album", artists: { primary: [{ name: "A" }] }, image: [{ quality: "500x500", url: "https://saavn-cover.jpg" }] }], total: 1 } } });
    }
    if (path.includes("/search/playlists")) {
      return Promise.resolve({ data: { data: { results: [{ id: "p1", name: "Saavn Playlist" }], total: 1 } } });
    }
    // One spotify call serves every requested type; return an amazon-style
    // row for albums (the spotify service maps it via normalizeAlbum).
    if (path === "/search") {
      return Promise.resolve({
        data: { results: [{ id: "z1", name: "Other Album", artist: "B", images: [{ url: "https://img" }] }] },
      });
    }
    return Promise.resolve({ data: { data: { results: [] } } });
  });

  const out = await searchService.search("q", { type: "album", limit: 10 });
  const albums = out.results.albums;
  assert.ok(albums.some((a) => a.source === "saavn" && a.id === "a1"));
  assert.ok(albums.some((a) => a.source === "spotify" && a.id === "z1"));
});

test("search represents multiple providers instead of the first API filling the page", async () => {
  axiosMock.setHandler((path) => {
    if (path.includes("/search/songs")) {
      return Promise.resolve({
        data: {
          data: {
            results: [
              { id: "s0", name: "Saavn 0", artist_name: "A" },
              { id: "s1", name: "Saavn 1", artist_name: "A" },
              { id: "s2", name: "Saavn 2", artist_name: "A" },
            ],
            total: 3,
          },
        },
      });
    }
    if (path === "/search") {
      return Promise.resolve({
        data: {
          results: [
            { id: "p0", name: "Other 0", artist_name: "B" },
            { id: "p1", name: "Other 1", artist_name: "B" },
          ],
        },
      });
    }
    return Promise.resolve({ data: { data: { results: [] } } });
  });

  const out = await searchService.search("q", { type: "track", limit: 3 });
  const sources = [...new Set(out.results.tracks.map((t) => t.source))];
  assert.ok(sources.includes("saavn"), `expected saavn in ${sources}`);
  assert.ok(sources.includes("spotify"), `expected spotify in ${sources}`);
});

test("search fills in playable audio for non-Saavn tracks", async () => {
  axiosMock.setHandler((path, config) => {
    const query = config?.params?.query;
    // The central enrich pass searches Saavn by track name + artist.
    if (path.includes("/search/songs") && query === "Other Song ArtistB") {
      return Promise.resolve({
        data: {
          data: {
            results: [
              {
                id: "sf",
                name: "Other Song",
                artists: { primary: [{ name: "ArtistB" }] },
                downloadUrl: [{ quality: "320kbps", url: "https://resolved.mp3" }],
                duration: 150,
                image: "https://cover.jpg",
              },
            ],
            total: 1,
          },
        },
      });
    }
    if (path.includes("/search/songs")) {
      return Promise.resolve({
        data: {
          data: {
            results: [
              {
                id: "s1",
                name: "Saavn Song",
                artists: { primary: [{ name: "ArtistA" }] },
                downloadUrl: [{ quality: "320kbps", url: "https://saavn.mp3" }],
                duration: 200,
                image: "https://saavn-cover.jpg",
              },
            ],
            total: 1,
          },
        },
      });
    }
    if (path === "/search") {
      return Promise.resolve({
        data: { results: [{ id: "p1", name: "Other Song", artist: "ArtistB", preview_url: "https://p.scdn.co/mp3-preview/xyz" }] },
      });
    }
    return Promise.resolve({ data: { data: { results: [] } } });
  });

  const out = await searchService.search("q", { type: "track", limit: 10 });
  const tracks = out.results.tracks;

  const other = tracks.find((t) => t.source !== "saavn");
  assert.ok(other, "non-saavn row should be present");
  assert.strictEqual(other.audio, "https://resolved.mp3");
  assert.strictEqual(other.duration, 150);

  const saavn = tracks.find((t) => t.source === "saavn");
  assert.strictEqual(saavn.audio, "https://saavn.mp3");
});

test("empty spotify/amazon/ytmusic sources fall back to Saavn rows (tagged fallbackOf)", async () => {
  axiosMock.setHandler((path) => {
    if (path.includes("/search/songs")) {
      return Promise.resolve({
        data: {
          data: {
            results: [
              { id: "s1", name: "Saavn Song", artist_name: "A" },
              { id: "s2", name: "Saavn Song 2", artist_name: "A" },
            ],
            total: 2,
          },
        },
      });
    }
    if (path === "/search") {
      return Promise.reject(new Error("spotify down"));
    }
    return Promise.resolve({ data: { data: { results: [] } } });
  });

  const out = await searchService.search("q", { type: "track", limit: 10 });
  const { tracksBySource } = out.results;

  // Spotify is down -> its group is filled with Saavn rows, honestly labeled.
  assert.ok(Array.isArray(tracksBySource.spotify) && tracksBySource.spotify.length === 2);
  assert.ok(tracksBySource.spotify.every((t) => t.source === "saavn"));
  assert.ok(tracksBySource.spotify.every((t) => t.fallbackOf === "spotify"));

  // YouTube Music returned nothing -> its group is filled the same way.
  assert.ok(Array.isArray(tracksBySource.ytmusic) && tracksBySource.ytmusic.length === 2);
  assert.ok(tracksBySource.ytmusic.every((t) => t.fallbackOf === "ytmusic"));

  // Amazon returned nothing -> its group is filled the same way.
  assert.ok(Array.isArray(tracksBySource.amazon) && tracksBySource.amazon.length === 2);
  assert.ok(tracksBySource.amazon.every((t) => t.fallbackOf === "amazon"));

  // Saavn's own group is untouched (no fallbackOf marker).
  assert.ok(tracksBySource.saavn.length === 2);
  assert.ok(tracksBySource.saavn.every((t) => !t.fallbackOf));

  // Merged list is still driven by real Saavn rows and stays playable.
  assert.ok(out.results.tracks.length >= 2);
});

test("spotify/amazon/ytmusic fallback does not trigger when Saavn itself is empty", async () => {
  axiosMock.setHandler((path) => {
    if (path.includes("/search/songs")) {
      return Promise.resolve({ data: { data: { results: [], total: 0 } } });
    }
    return Promise.reject(new Error("provider down"));
  });

  const out = await searchService.search("q", { type: "track", limit: 10 });
  assert.deepStrictEqual(out.results.tracksBySource.spotify, []);
  assert.deepStrictEqual(out.results.tracksBySource.ytmusic, []);
  assert.deepStrictEqual(out.results.tracksBySource.amazon, []);
  assert.deepStrictEqual(out.results.tracks, []);
});

test("ytmusic rows appear in their own group and the merged list", async () => {
  ytService.search = async (query, opts = {}) => {
    const type = opts.type === "track" ? "track" : "album";
    return {
      total: 1,
      results: {
        [type]: [
          {
            id: "aBcDeFgHiJk",
            name: "YT Song",
            artist_name: "YT Artist",
            source: "ytmusic",
            image: "https://i.ytimg.com/yt.jpg",
            audio: "/api/ytmusic/songs/aBcDeFgHiJk/stream",
            duration: 210,
          },
        ],
      },
    };
  };
  axiosMock.setHandler((path) => {
    if (path.includes("/search/songs")) {
      return Promise.resolve({
        data: {
          data: {
            results: [
              {
                id: "s1",
                name: "Saavn Song",
                artists: { primary: [{ name: "Artist" }] },
                downloadUrl: [{ quality: "320kbps", url: "https://saavn.mp3" }],
                duration: 200,
                image: "https://saavn-cover.jpg",
              },
            ],
            total: 1,
          },
        },
      });
    }
    return Promise.resolve({ data: { results: [] } });
  });

  const out = await searchService.search("q", { type: "track", limit: 10 });
  const { tracksBySource } = out.results;

  assert.strictEqual(tracksBySource.ytmusic.length, 1);
  assert.strictEqual(tracksBySource.ytmusic[0].source, "ytmusic");
  assert.strictEqual(
    tracksBySource.ytmusic[0].audio,
    "/api/ytmusic/songs/aBcDeFgHiJk/stream"
  );

  const inMerged = out.results.tracks.some((t) => t.source === "ytmusic");
  assert.ok(inMerged, "ytmusic rows should be part of the merged track list");
});

test("merged resolution is stamped onto matching per-source rows", async () => {
  axiosMock.setHandler((path, config) => {
    const query = config?.params?.query;
    // Resolver searches Saavn by name+artist and finds the full copy.
    if (path.includes("/search/songs") && query === "Other Song ArtistB") {
      return Promise.resolve({
        data: {
          data: {
            results: [
              {
                id: "sf",
                name: "Other Song",
                artists: { primary: [{ name: "ArtistB" }] },
                downloadUrl: [{ quality: "320kbps", url: "https://resolved.mp3" }],
                duration: 150,
                image: "https://cover.jpg",
              },
            ],
            total: 1,
          },
        },
      });
    }
    // Saavn provider search: same song, no audio attached.
    if (path.includes("/search/songs")) {
      return Promise.resolve({
        data: { data: { results: [{ id: "s1", name: "Other Song", artists: { primary: [{ name: "ArtistB" }] } }], total: 1 } },
      });
    }
    // Spotify preview row.
    if (path === "/search") {
      return Promise.resolve({
        data: { results: [{ id: "p1", name: "Other Song", artist: "ArtistB", preview_url: "https://p.scdn.co/mp3-preview/xyz" }] },
      });
    }
    return Promise.resolve({ data: { data: { results: [] } } });
  });

  const out = await searchService.search("q", { type: "track", limit: 10 });
  const { tracksBySource } = out.results;

  // The spotify tab row now plays immediately (stamped audio, no resolve round-trip).
  assert.strictEqual(tracksBySource.spotify[0].audio, "https://resolved.mp3");
  // The amazon group fell back to Saavn rows, which were likewise stamped.
  assert.strictEqual(tracksBySource.amazon[0].audio, "https://resolved.mp3");
  // The merged list itself carries the audio.
  assert.ok(out.results.tracks.some((t) => t.audio === "https://resolved.mp3"));
});

test("source-tab rows that miss the merged page still get playable audio", async () => {
  axiosMock.setHandler((path, config) => {
    const query = config?.params?.query;
    // Resolver pass for the off-page spotify rows (name + first artist).
    if (path.includes("/search/songs") && query?.startsWith("Offscreen Song")) {
      const row = {
        id: "sf",
        name: query.split(" Artist")[0],
        artists: { primary: [{ name: "ArtistC" }] },
        downloadUrl: [{ quality: "320kbps", url: "https://resolved-offscreen.mp3" }],
        duration: 180,
        image: "https://cover.jpg",
      };
      return Promise.resolve({ data: { data: { results: [row], total: 1 } } });
    }
    // Saavn provider search (the only row that fits the merged page).
    if (path.includes("/search/songs")) {
      return Promise.resolve({
        data: {
          data: {
            results: [
              {
                id: "s1",
                name: "Saavn A",
                artists: { primary: [{ name: "ArtistA" }] },
                downloadUrl: [{ quality: "320kbps", url: "https://saavn.mp3" }],
                duration: 200,
                image: "https://saavn-cover.jpg",
              },
            ],
            total: 1,
          },
        },
      });
    }
    if (path === "/search") {
      return Promise.resolve({
        data: {
          results: [
            { id: "p1", name: "Offscreen Song", artist: "ArtistC", preview_url: "https://p.scdn.co/mp3-preview/xyz" },
            { id: "p2", name: "Offscreen Song 2", artist: "ArtistC", preview_url: "https://p.scdn.co/mp3-preview/abc" },
          ],
        },
      });
    }
    return Promise.resolve({ data: { data: { results: [] } } });
  });

  const out = await searchService.search("q", { type: "track", limit: 1 });
  const { tracksBySource } = out.results;

  // Limit 1 -> the merged page holds only the Saavn row, yet the spotify tab
  // rows missed by stamping are still resolved in the bounded source-list pass.
  assert.ok(tracksBySource.spotify.length === 2);
  for (const row of tracksBySource.spotify) {
    assert.strictEqual(row.audio, "https://resolved-offscreen.mp3");
  }
});

test("search tolerates upstream failures (safe wrapper returns empty)", async () => {
  axiosMock.fail(500, "boom");
  const out = await searchService.search("q", { type: "track", limit: 10 });
  assert.deepStrictEqual(out.results.tracks, []);
  assert.strictEqual(out.total, 0);
});

test("search memoizes identical queries", async () => {
  let calls = 0;
  axiosMock.setHandler((path) => {
    calls += 1;
    return Promise.resolve({ data: { data: { results: [trackResult("a")], total: 1 } } });
  });
  await searchService.search("same", { type: "track", limit: 5 });
  const afterFirst = calls; // 3 providers fire once
  await searchService.search("same", { type: "track", limit: 5 });
  assert.strictEqual(calls, afterFirst); // memoized -> no additional upstream calls
  assert.ok(afterFirst >= 3);
});
