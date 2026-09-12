const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const axiosMock = require("./helpers/mockAxios");

const { cache } = require("../src/services/cache.service");
const SERVICE_PATH = require.resolve("../src/services/ytmusic.service");
const CONFIG_PATH = require.resolve("../src/config/ytmusic");

// Row renderer helpers mirroring the real youtubei shapes captured live.
const col = (text) => ({
  musicResponsiveListItemFlexColumnRenderer: {
    text: { runs: Array.isArray(text) ? text : [{ text }] },
  },
});

const flaggedCol = (runs) => ({
  musicResponsiveListItemFlexColumnRenderer: { text: { runs } },
});

const thumb = (url, width, height) => ({
  musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url, width, height }] } },
});

const shelfItem = (row) => ({
  itemSectionRenderer: {
    contents: [{ musicResponsiveListItemRenderer: row }],
  },
});

const ALBUM_ROW = {
  thumbnail: thumb("https://lh3.googleusercontent.com/abc_album=w544-h544-l90-rj", 544, 544),
  flexColumns: [
    col("Yajaman"),
    flaggedCol([
      { text: "Album" },
      { text: " • " },
      { text: "Ilayaraja" },
      { text: " • " },
      { text: "2025" },
    ]),
    col(""),
  ],
  navigationEndpoint: { browseEndpoint: { browseId: "MPREb_LfFKcBlMgOT" } },
};

const PLAYLIST_ROW = {
  thumbnail: thumb("https://lh3.googleusercontent.com/abc_pl=w544-h544-l90-rj", 544, 544),
  flexColumns: [
    col("Presenting Ilaiyaraaja (Tamil)"),
    flaggedCol([
      { text: "Playlist" },
      { text: " • " },
      { text: "YouTube Music" },
      { text: " • " },
      { text: "104 songs" },
    ]),
    col(""),
  ],
  navigationEndpoint: { browseEndpoint: { browseId: "VLRDCLAK5uy_kOZNV6ZRIRFAYIjWgzk5liNbfdOpM2XkM" } },
};

const ARTIST_ROW = {
  thumbnail: thumb("https://lh3.googleusercontent.com/abc_artist=w544-h544-l90-rj", 544, 544),
  flexColumns: [
    col("Ilayaraja"),
    flaggedCol([{ text: "Artist" }, { text: " • " }, { text: "9 subscribers" }]),
    col(""),
  ],
  navigationEndpoint: { browseEndpoint: { browseId: "UCT4pLbOXS_SZydXX-516YgQ" } },
};

const SONG_ROW = {
  flexColumns: [col("Semanthana Chord"), flaggedCol([{ text: "Song" }, { text: " • " }, { text: "SPB" }]), col("")],
};

const VIDEO_ROW = {
  flexColumns: [col("Some clip"), flaggedCol([{ text: "Video" }, { text: " • " }, { text: "x" }]), col("")],
};

const SEARCH_FIXTURE = [
  shelfItem(ALBUM_ROW),
  shelfItem(PLAYLIST_ROW),
  shelfItem(ARTIST_ROW),
  shelfItem(SONG_ROW),
  shelfItem(VIDEO_ROW),
];

// Same tag run helper is only needed to build the " • " separated header line.
const headerRenderer = (title, subtitleParts, imageUrl) => {
  const runs = [
    { text: subtitleParts[0] },
    ...subtitleParts.slice(1).flatMap((t) => [{ text: " • " }, { text: t }]),
  ];
  return {
    musicResponsiveHeaderRenderer: {
      title: { runs: [{ text: title }] },
      subtitle: { runs },
      thumbnail: thumb(imageUrl, 544, 544),
    },
  };
};

const detailTrack = (videoId, title, artist, durationText, plays = "") => ({
  musicResponsiveListItemRenderer: {
    thumbnail: thumb(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg?x`, 400, 225),
    flexColumns: [col(title), col(artist), col(plays)],
    fixedColumns: [
      {
        musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: durationText }] } },
      },
    ],
    playlistItemData: { videoId },
    videoId,
  },
});

const PLAYLIST_BROWSE_FIXTURE = {
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  headerRenderer("Presenting Ilaiyaraaja (Tamil)", ["Playlist", "2026"], "https://yt3.example/cover.jpg"),
                  {
                    musicPlaylistShelfRenderer: {
                      contents: [
                        detailTrack("N0KfiOTSpxs", 'Kalyana Virundhu (From "Dorothy")', "Anthony Daasan", "3:57"),
                        detailTrack("RhaJAXplabc", "Raja Raja Chozhan", "Mu. Metha", "4:12"),
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
};

const ALBUM_BROWSE_FIXTURE = {
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  headerRenderer("Yajaman", ["Album", "2025"], "https://yt3.example/yajaman.jpg"),
                  {
                    musicShelfRenderer: {
                      contents: [
                        detailTrack("GY9g9CFovBo", "Aalappol Velappol", "SP Balasubramaniyam, KS Chitra", "5:43"),
                        detailTrack("FspydovOlZU", "Adi Raakumuthu", "SP Balasubramaniyam, Chorus", "4:01"),
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
};

const wrapSearch = (contents) => ({
  contents: {
    tabbedSearchResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: { contents },
            },
          },
        },
      ],
    },
  },
});

const loadService = () => {
  const svc = axiosMock.fresh("../src/services/ytmusic.service");
  return svc;
};

beforeEach(() => {
  axiosMock.reset();
  axiosMock.install();
  cache.flushAll();
  // Config re-reads env at require-time, and loadService() re-requires the
  // service (plus its config) fresh, so purge the config cache per test.
  delete require.cache[CONFIG_PATH];
  delete require.cache[SERVICE_PATH];
});

afterEach(() => {
  axiosMock.restore();
});

test("searchCatalog returns musicAlbum rows only and skips songs/videos", async () => {
  const calls = [];
  axiosMock.setHandler((path, config) => {
    calls.push(path);
    return Promise.resolve({ data: wrapSearch(SEARCH_FIXTURE) });
  });
  const svc = loadService();
  const out = await svc.searchCatalog("ilayaraja", "album", 20, 0);
  assert.strictEqual(out.length, 1);
  const a = out[0];
  assert.strictEqual(a.id, "MPREb_LfFKcBlMgOT");
  assert.strictEqual(a.name, "Yajaman");
  assert.strictEqual(a.type, "album");
  assert.strictEqual(a.artist_name, "Ilayaraja");
  assert.strictEqual(a.year, "2025");
  assert.match(a.image, /^https:/);
  assert.match(a.url, /\/browse\/MPREb_LfFKcBlMgOT$/);
});

test("searchCatalog parses playlist track count and strips the VL prefix", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: wrapSearch(SEARCH_FIXTURE) }));
  const svc = loadService();
  const out = await svc.searchCatalog("ilayaraja", "playlist", 20, 0);
  assert.strictEqual(out.length, 1);
  const p = out[0];
  assert.strictEqual(p.type, "playlist");
  assert.strictEqual(p.name, "Presenting Ilaiyaraaja (Tamil)");
  assert.strictEqual(p.track_count, 104);
  assert.strictEqual(p.id, "RDCLAK5uy_kOZNV6ZRIRFAYIjWgzk5liNbfdOpM2XkM");
  assert.match(p.url, /playlist\?list=RDCLAK5uy_kOZNV6ZRIRFAYIjWgzk5liNbfdOpM2XkM$/);
});

test("searchCatalog returns empty for unsupported kinds without throwing", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: wrapSearch(SEARCH_FIXTURE) }));
  const svc = loadService();
  assert.deepStrictEqual(await svc.searchCatalog("x", "track", 20, 0), []);
});

test("searchCatalog returns artist rows with their native channel id", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: wrapSearch(SEARCH_FIXTURE) }));
  const svc = loadService();
  const out = await svc.searchCatalog("ilayaraja", "artist", 20, 0);
  assert.strictEqual(out.length, 1);
  const a = out[0];
  assert.strictEqual(a.type, "artist");
  assert.strictEqual(a.id, "UCT4pLbOXS_SZydXX-516YgQ");
  assert.strictEqual(a.name, "Ilayaraja");
  assert.match(a.image, /^https:/);
  assert.match(a.url, /\/channel\/UCT4pLbOXS_SZydXX-516YgQ$/);
});

test("searchCatalog memoizes per query/type so repeated calls reuse one POST", async () => {
  let calls = 0;
  axiosMock.setHandler(() => {
    calls += 1;
    return Promise.resolve({ data: wrapSearch(SEARCH_FIXTURE) });
  });
  const svc = loadService();
  const a = await svc.searchCatalog("ilayaraja", "album", 20, 0);
  const b = await svc.searchCatalog("ilayaraja", "album", 20, 0);
  assert.strictEqual(a[0].id, b[0].id);
  assert.strictEqual(calls, 1);
});

test("searchCatalog rejects with 503 when the provider is disabled", async () => {
  process.env.YT_ENABLED = "false";
  try {
    const svc = loadService();
    await assert.rejects(svc.searchCatalog("x", "album", 20, 0), (err) => err.status === 503);
  } finally {
    delete process.env.YT_ENABLED;
  }
});

test("search wiring: type=album flows through search() with rows + total", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: wrapSearch(SEARCH_FIXTURE) }));
  const svc = loadService();
  const { total, results } = await svc.search("ilayaraja", { type: "album", limit: 20, offset: 0 });
  assert.strictEqual(results.album.length, 1);
  assert.strictEqual(results.album[0].id, "MPREb_LfFKcBlMgOT");
  assert.strictEqual(total, 1);
});

test("search wiring: type=artist flows through search() too", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: wrapSearch(SEARCH_FIXTURE) }));
  const svc = loadService();
  const { total, results } = await svc.search("ilayaraja", { type: "artist", limit: 20, offset: 0 });
  assert.strictEqual(results.artist.length, 1);
  assert.strictEqual(results.artist[0].id, "UCT4pLbOXS_SZydXX-516YgQ");
  assert.strictEqual(total, 1);
});

test("getCollectionDetail for a playlist returns header + playable songs", async () => {
  axiosMock.setHandler((path) =>
    Promise.resolve({ data: PLAYLIST_BROWSE_FIXTURE })
  );
  const svc = loadService();
  const bare = "RDCLAK5uy_kOZNV6ZRIRFAYIjWgzk5liNbfdOpM2XkM";
  const detail = await svc.getCollectionDetail(svc.playlistBrowseId(bare));
  assert.strictEqual(detail.id, bare);
  assert.strictEqual(detail.name, "Presenting Ilaiyaraaja (Tamil)");
  assert.strictEqual(detail.type, "playlist");
  assert.strictEqual(detail.track_count, 2);
  assert.strictEqual(detail.song_count, 0);
  const first = detail.songs[0];
  assert.strictEqual(first.id, "N0KfiOTSpxs");
  assert.strictEqual(first.name, 'Kalyana Virundhu (From "Dorothy")');
  assert.strictEqual(first.artist_name, "Anthony Daasan");
  assert.strictEqual(first.duration, 237);
  assert.strictEqual(first.audio, "/api/ytmusic/songs/N0KfiOTSpxs/stream");
  assert.strictEqual(first.source, "ytmusic");
});

test("getCollectionDetail for an album detects Album kind and returns songs", async () => {
  axiosMock.setHandler(() => Promise.resolve({ data: ALBUM_BROWSE_FIXTURE }));
  const svc = loadService();
  const detail = await svc.getCollectionDetail("MPREb_LfFKcBlMgOT");
  assert.strictEqual(detail.type, "album");
  assert.strictEqual(detail.name, "Yajaman");
  assert.strictEqual(detail.year, "2025");
  assert.strictEqual(detail.song_count, 2);
  assert.strictEqual(detail.songs[0].id, "GY9g9CFovBo");
  assert.strictEqual(detail.songs[0].duration, 343);
  assert.strictEqual(detail.songs[1].audio, "/api/ytmusic/songs/FspydovOlZU/stream");
});

test("mapHttpError-level failures surface as YtStreamError 502", async () => {
  axiosMock.setHandler(() => Promise.reject(new Error("ECONNRESET")));
  const svc = loadService();
  await assert.rejects(svc.searchCatalog("x", "album", 20, 0), (err) => err.status === 502);
});