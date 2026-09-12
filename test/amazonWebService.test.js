const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const axiosMock = require("./helpers/mockAxios");

let amazonWeb;

// amazonWeb imports trackResolver → ytmusic.service, which would spawn live
// yt-dlp in tests (network + nondeterministic). Stub it disabled so resolution
// keeps its original values and tests stay deterministic.
const YT_SERVICE = require.resolve("../src/services/ytmusic.service");
const installYtDisabled = () => {
  delete require.cache[YT_SERVICE];
  require.cache[YT_SERVICE] = {
    id: YT_SERVICE,
    filename: YT_SERVICE,
    loaded: true,
    exports: {
      isEnabled: () => false,
      isBreakerOpen: () => false,
      searchTrack: async () => null,
    },
  };
};

beforeEach(() => {
  axiosMock.reset();
  axiosMock.install();
  installYtDisabled();
  amazonWeb = axiosMock.fresh("../src/services/amazonWeb.service");
});

afterEach(() => {
  axiosMock.restore();
});

const CONFIG = {
  accessToken: "",
  deviceId: "D1",
  sessionId: "S1",
  version: "3.1",
  csrf: { token: "T1", ts: 1700000000000, rnd: "R1" },
};

const wrapItems = (items) => ({ methods: [{ template: { widgets: [{ items }] } }] });

const SONG_ITEM = {
  iconButton: { observer: { storageKey: "ALB1:TRK1" } },
  primaryText: { text: "Lavender Haze" },
  secondaryLink: { deeplink: "/artists/ART1" },
  secondaryText: "Taylor Swift",
  image: "https://img.amazon.com/I/51abc._AA354_.jpg",
  contextMenu: {
    options: [
      {
        onItemSelected: [
          null,
          {
            template: {
              headerText: { text: "Midnight" },
              templateData: { seoHead: { link: [{ href: "https://music.amazon.com/albums/ALB1" }] } },
            },
          },
        ],
      },
    ],
  },
};

const ALBUM_FIXTURE = {
  methods: [
    {
      template: {
        interface: "Web.TemplatesInterface.v1_0.Touch.AlbumTemplateInterface",
        headerText: { text: "Midnight" },
        headerImage: "https://img.amazon.com/I/51mid.",
        headerTertiaryText: "12 SONGS  •  54 MINUTES  •  APR 03 2013",
        headerPrimaryText: "Taylor Swift",
        headerPrimaryTextLink: { deeplink: "/artists/ART1" },
        widgets: [
          {
            items: [
              { primaryTextLink: { deeplink: "/tracks/TRK1" }, primaryText: "Lavender Haze", secondaryText2: "Taylor Swift", secondaryText2Link: { deeplink: "/artists/ART1" }, secondaryText3: "3:22" },
              { primaryTextLink: { deeplink: "/tracks/TRK2" }, primaryText: "Maroon", secondaryText2: "Taylor Swift", secondaryText2Link: { deeplink: "/artists/ART1" }, secondaryText3: "3:38" },
            ],
          },
        ],
      },
    },
  ],
};

const ARTIST_FIXTURE = {
  methods: [
    {
      template: {
        headerText: { text: "Taylor Swift" },
        headerImage: "https://img.amazon.com/I/51artist.",
        backgroundImage: "https://img.amazon.com/I/51bg.",
        widgets: [
          {
            header: "Top songs",
            items: [
              {
                iconButton: { observer: { storageKey: "ALB1:TRK1" } },
                primaryText: { text: "1. Lavender Haze" },
                secondaryText: "Taylor Swift",
                image: "https://img.amazon.com/I/51song.",
                contextMenu: {
                  options: [
                    { onItemSelected: [null, { template: { headerText: { text: "Midnight" } } }] },
                    { onItemSelected: [null, null, { template: { templateData: { seoHead: { link: [{ href: "https://music.amazon.com/artists/ART1" }] } } } }] },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
  ],
};

const TRACK_FIXTURE = {
  methods: [
    {
      template: {
        headerText: { text: "Lavender Haze" },
        headerImage: "https://img.amazon.com/I/51track.",
        headerPrimaryText: "Taylor Swift",
        headerPrimaryTextLink: { deeplink: "/artists/ART1" },
        templateData: { seoHead: { script: [{ innerHTML: JSON.stringify({ isrcCode: "USRC12345" }) }] } },
        contextMenu: {
          options: [
            null,
            {
              onItemSelected: [
                null,
                {
                  template: {
                    headerText: { text: "Midnight" },
                    templateData: { deeplink: "/albums/ALB1", seoHead: { link: [{ href: "https://music.amazon.com/albums/ALB1" }] } },
                  },
                },
              ],
            },
          ],
        },
        widgets: [{ header: "Album Tracklist", items: [{ primaryTextLink: { deeplink: "/tracks/TRK1" }, secondaryText3: "3:22" }] }],
      },
    },
  ],
};

const PLAYLIST_FIXTURE = {
  methods: [
    {
      template: {
        headerText: { text: "Today's Hits" },
        headerImage: "https://img.amazon.com/I/51playlist.",
        headerTertiaryText: "50 SONGS",
        widgets: [
          {
            items: [
              {
                iconButton: { observer: { storageKey: "ALB1:TRK1" } },
                primaryText: "Song One",
                secondaryText1: "Artist One",
                secondaryText1Link: { deeplink: "/artists/ART1" },
                secondaryText2: "Album One",
                secondaryText3: "3:30",
                image: "https://img.amazon.com/I/51pl.",
              },
            ],
          },
        ],
      },
    },
  ],
};

const COMMUNITY_FIXTURE = {
  methods: [
    {
      template: {
        headerText: { text: "My Mix" },
        headerImage: "https://img.amazon.com/I/51community.",
        widgets: [
          {
            items: [
              {
                id: "TRK9",
                primaryText: "Community Song",
                secondaryText1: "A User",
                secondaryText1Link: { deeplink: "/artists/ART9" },
                secondaryText2: "Community Album",
                secondaryText3: "2:45",
                image: "https://img.amazon.com/I/51cm.",
              },
            ],
          },
        ],
      },
    },
  ],
};

// Branches a raw URL onto the right fixture; config calls always get CONFIG.
const skillResponder = ({ album = ALBUM_FIXTURE, track = TRACK_FIXTURE, artist = ARTIST_FIXTURE, playlist = PLAYLIST_FIXTURE, community = COMMUNITY_FIXTURE } = {}) => (url, cfg) => {
  if (url.endsWith("/config.json")) return Promise.resolve({ data: CONFIG, status: 200 });
  const method = cfg?.method || "get";
  if (method === "post") {
    if (url.endsWith("/api/searchCatalogTracks")) return Promise.resolve({ data: wrapItems([SONG_ITEM]), status: 200 });
    if (url.endsWith("/api/searchCatalogAlbums")) {
      return Promise.resolve({
        data: wrapItems([{ iconButton: { observer: { storageKey: "ALB1" } }, primaryText: { text: "Midnight" }, secondaryText: "Taylor Swift", secondaryLink: { deeplink: "/artists/ART1" }, image: "https://img.amazon.com/I/51alb." }]),
        status: 200,
      });
    }
    if (url.endsWith("/api/searchCatalogArtists")) {
      return Promise.resolve({ data: wrapItems([{ iconButton: { observer: { storageKey: "ART1" } }, primaryText: { text: "Taylor Swift" }, image: "https://img.amazon.com/I/51art." }]), status: 200 });
    }
    if (url.endsWith("/api/searchCatalogPlaylists")) {
      return Promise.resolve({ data: wrapItems([{ iconButton: { observer: { storageKey: "PL1" } }, primaryText: { text: "Today's Hits" }, image: "https://img.amazon.com/I/51pl." }]), status: 200 });
    }
    if (url.endsWith("/api/cosmicTrack/displayCatalogTrack")) return Promise.resolve({ data: track, status: 200 });
    if (url.endsWith("/api/showCatalogAlbum")) return Promise.resolve({ data: album, status: 200 });
    if (url.endsWith("/api/explore/v1/showCatalogArtist")) return Promise.resolve({ data: artist, status: 200 });
    if (url.endsWith("/api/showCatalogPlaylist")) return Promise.resolve({ data: playlist, status: 200 });
    if (url.endsWith("/api/showLibraryPlaylist")) return Promise.resolve({ data: community, status: 200 });
  }
  return Promise.reject(new Error(`unexpected request: ${method} ${url}`));
};

test("search returns normalized grouped results across all four types", async () => {
  const seen = [];
  axiosMock.setHandler((url, cfg) => {
    seen.push({ url, method: cfg?.method || "get", body: cfg?.data });
    return skillResponder()(url, cfg);
  });
  const out = await amazonWeb.search("query", {});
  assert.equal(out.total, 4);
  assert.equal(out.results.track.length, 1);
  assert.equal(out.results.album.length, 1);
  assert.equal(out.results.artist.length, 1);
  assert.equal(out.results.playlist.length, 1);

  const track = out.results.track[0];
  assert.equal(track.name, "Lavender Haze");
  assert.equal(track.source, "amazon");
  assert.equal(track.artist_name, "Taylor Swift");
  assert.equal(track.album_name, "Midnight");
  assert.equal(track.duration, 202); // resolved from the album tracklist secondary call
  assert.match(track.playParams.id, /^mrn:1\.0:catalog:track:asin:TRK1$/);
  assert.deepEqual(track.playParams.containerIds, ["mrn:1.0:catalog:album:asin:ALB1"]);

  assert.equal(out.results.album[0].name, "Midnight");
  assert.equal(out.results.album[0].artist_name, "Taylor Swift");
  assert.equal(out.results.artist[0].name, "Taylor Swift");
  assert.equal(out.results.playlist[0].name, "Today's Hits");
  assert.equal(out.results.playlist[0].owner.name, "Amazon Music");

  // The skill identity rides inside the POST body's `headers` string.
  const searchBody = seen.find((s) => s.url.endsWith("/api/searchCatalogTracks"));
  assert.ok(searchBody);
  assert.equal(searchBody.body.keyword, "query");
  assert.deepEqual(JSON.parse(searchBody.body.userHash), { level: "LIBRARY_MEMBER" });
  const inner = JSON.parse(searchBody.body.headers);
  assert.equal(inner["x-amzn-device-id"], "D1");
  assert.equal(JSON.parse(inner["x-amzn-csrf"]).token, "T1");
  assert.ok(inner["x-amzn-page-url"].includes("/songs"));
});

test("search page >= 2 without a token falls back to page 1", async () => {
  axiosMock.setHandler((url, cfg) => {
    if (url.endsWith("/config.json")) return Promise.resolve({ data: CONFIG, status: 200 });
    if (url.endsWith("/api/searchCatalogTracks")) {
      if (cfg?.data?.next) return Promise.resolve({ data: { methods: [{ items: [SONG_ITEM] }] }, status: 200 });
      return Promise.resolve({ data: wrapItems([SONG_ITEM]), status: 200 });
    }
    if (url.endsWith("/api/showCatalogAlbum")) return Promise.resolve({ data: ALBUM_FIXTURE, status: 200 });
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
  // page 2 with no continuity token: fall back to page-1 results instead of
  // dropping the whole provider (unified search only ever passes `page`).
  const out = await amazonWeb.search("q", { type: "track", page: 2 });
  assert.equal(out.results.track.length, 1);
  // with a token it proceeds and finds items in methods[0].items
  const paged = await amazonWeb.search("q", { type: "track", page: 2, next: "tztok-v2_xxx" });
  assert.equal(paged.results.track.length, 1);
});

test("getTrackById parses isrc, duration, album and artist", async () => {
  axiosMock.setHandler(skillResponder());
  const track = await amazonWeb.getTrackById("TRK1");
  assert.ok(track);
  assert.equal(track.name, "Lavender Haze");
  assert.equal(track.duration, 202); // 3:22
  assert.equal(track.playParams.id, "mrn:1.0:catalog:track:asin:TRK1");
  assert.deepEqual(track.playParams.containerIds, ["mrn:1.0:catalog:album:asin:ALB1"]);
  assert.equal(track.album_id, "ALB1");
  assert.equal(track.artist_name, "Taylor Swift");
  assert.equal(track.id, "TRK1");
});

test("getTrackById returns null for a missing track", async () => {
  axiosMock.setHandler((url) => {
    if (url.endsWith("/config.json")) return Promise.resolve({ data: CONFIG, status: 200 });
    if (url.endsWith("/api/cosmicTrack/displayCatalogTrack")) {
      return Promise.resolve({
        data: {
          methods: [
            {
              interface: "Web.TemplatesInterface.v1_0.Touch.ChromeTemplateInterface.ShowNotificationMethod",
              notification: { message: { text: "This track is no longer available" } },
            },
          ],
        },
        status: 200,
      });
    }
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
  assert.equal(await amazonWeb.getTrackById("GONE"), null);
});

test("getAlbumById fans out regions and normalizes tracklist + totals", async () => {
  let regionPostCount = 0;
  axiosMock.setHandler((url, cfg) => {
    if (url.endsWith("/config.json")) return Promise.resolve({ data: CONFIG, status: 200 });
    if (url.endsWith("/api/showCatalogAlbum") && cfg?.method === "post") {
      regionPostCount += 1;
      return Promise.resolve({ data: ALBUM_FIXTURE, status: 200 });
    }
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
  const album = await amazonWeb.getAlbumById("ALB1");
  assert.ok(album);
  assert.equal(album.name, "Midnight");
  assert.equal(album.year, "2013");
  assert.equal(album.song_count, 12);
  assert.equal(album.songs.length, 2);
  assert.equal(album.songs[0].name, "Lavender Haze");
  assert.equal(album.songs[0].duration, 202);
  assert.deepEqual(album.songs[0].playParams.containerIds, ["mrn:1.0:catalog:album:asin:ALB1"]);
  assert.ok(regionPostCount >= 1, "should attempt at least one regional endpoint");
});

test("getAlbumById returns null when every region reports an error dialog", async () => {
  axiosMock.setHandler((url) => {
    if (url.endsWith("/config.json")) return Promise.resolve({ data: CONFIG, status: 200 });
    if (url.endsWith("/api/showCatalogAlbum")) {
      return Promise.resolve({
        data: { methods: [{ template: { interface: "Web.TemplatesInterface.v1_0.Touch.DialogTemplateInterface.DialogTemplate", header: "Service error", widgets: [], templateData: { deeplink: "/" } } }] },
        status: 200,
      });
    }
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
  assert.equal(await amazonWeb.getAlbumById("BAD"), null);
});

test("getArtistById returns normalized artist + top songs with resolved durations", async () => {
  axiosMock.setHandler(skillResponder());
  const data = await amazonWeb.getArtistById("ART1");
  assert.ok(data);
  assert.equal(data.artist.name, "Taylor Swift");
  assert.equal(data.artist.id, "ART1");
  assert.equal(data.topSongs.length, 1);
  const song = data.topSongs[0];
  assert.equal(song.name, "Lavender Haze"); // leading "1. " stripped
  assert.equal(song.duration, 202); // from album tracklist secondary call
  assert.equal(song.album_id, "ALB1");
});

test("getArtistById returns null for a missing artist", async () => {
  axiosMock.setHandler((url) => {
    if (url.endsWith("/config.json")) return Promise.resolve({ data: CONFIG, status: 200 });
    if (url.endsWith("/api/explore/v1/showCatalogArtist")) {
      return Promise.resolve({
        data: { methods: [{ template: { interface: "MessageTemplate", header: "We're Sorry" }, items: [{ message: { text: "We are unable to complete your action" } }] }] },
        status: 200,
      });
    }
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
  assert.equal(await amazonWeb.getArtistById("GONE"), null);
});

test("getPlaylistById normalizes playlist with tracklist", async () => {
  axiosMock.setHandler(skillResponder());
  const playlist = await amazonWeb.getPlaylistById("PL1");
  assert.ok(playlist);
  assert.equal(playlist.name, "Today's Hits");
  assert.equal(playlist.owner.name, "Amazon Music");
  assert.equal(playlist.track_count, 50);
  assert.equal(playlist.songs.length, 1);
  assert.equal(playlist.songs[0].name, "Song One");
  assert.equal(playlist.songs[0].duration, 210);
  assert.equal(playlist.songs[0].artist_name, "Artist One");
});

test("getCommunityPlaylistById normalizes community playlists", async () => {
  axiosMock.setHandler(skillResponder());
  const playlist = await amazonWeb.getCommunityPlaylistById("CP1");
  assert.ok(playlist);
  assert.equal(playlist.name, "My Mix");
  assert.equal(playlist.owner.name, "Community User");
  assert.equal(playlist.songs[0].duration, 165);
});

test("helper text parsers behave like the reference implementation", () => {
  const i = amazonWeb._internals;
  assert.equal(i.durationToSeconds("3:45"), 225);
  assert.equal(i.durationToSeconds("1:02:03"), 3723);
  assert.equal(i.durationToSeconds("120"), 120);
  assert.equal(i.durationToSeconds(""), 0);
  assert.equal(i.extractSongsCountFromText("12 SONGS  •  54 MINUTES  •  APR 03 2013"), 12);
  assert.equal(i.extractDurationFromText("1 HOUR AND 5 MINUTES"), 3900);
  assert.equal(i.extractDurationFromText("54 MINUTES"), 3240);
  assert.equal(i.extractDurationFromText("You Better Eat Breakfast or I'll Mow the Yard"), null);
  assert.equal(i.extractReleaseDateFromText("APR 03 2013"), "2013-04-03");
  assert.equal(i.extractReleaseDateFromText("Nothing"), null);

  // _CLa%7C images get bumped to 1000x1000 and stripped of AA suffixes.
  const cleaned = i.cleanImageUrl("https://m.media-amazon.com/images/I/51xyz._AC_CLa%7C0,0,354,354%7C.JPG");
  assert.ok(!cleaned.includes("_AA") && !cleaned.includes("354,354"));
  assert.equal(i.cleanSongTitle("1. Lavender Haze"), "Lavender Haze");
  assert.equal(i.cleanSongTitle("Lavender Haze"), "Lavender Haze");
});

test("upstream failures surface as AmazonWebError with a real status", async () => {
  axiosMock.setHandler(() => {
    const err = new Error("Upstream unavailable");
    err.isAxiosError = true;
    err.response = { status: 503, data: { message: "Unavailable" } };
    return Promise.reject(err);
  });
  await assert.rejects(amazonWeb.search("q", { type: "track" }), (err) => {
    assert.equal(err.name, "AmazonWebError");
    assert.equal(err.status, 503);
    return true;
  });
});