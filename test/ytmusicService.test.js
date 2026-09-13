const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const { EventEmitter, Readable } = require("node:stream");
const { cache } = require("../src/services/cache.service");
const axiosMock = require("./helpers/mockAxios");

const YTDLP_PATH = require.resolve("yt-dlp-exec");
const SERVICE_PATH = require.resolve("../src/services/ytmusic.service");
const CONFIG_PATH = require.resolve("../src/config/ytmusic");

let execSpy = null;

// Fake yt-dlp child: EventEmitter with readable stdout/stderr streams and a
// kill(). Emits 'close' after both streams end, honoring the exit code.
const makeChild = ({ stdout = "", stderr = "", exitCode = 0 } = {}) => {
  const child = new EventEmitter();
  child.stdout = Readable.from([Buffer.from(String(stdout))]);
  child.stderr = Readable.from([Buffer.from(String(stderr))]);
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  let ended = 0;
  const maybeClose = () => {
    if (++ended === 2) child.emit("close", exitCode);
  };
  child.stdout.on("end", maybeClose);
  child.stderr.on("end", maybeClose);
  return child;
};

const loadService = () => {
  delete require.cache[SERVICE_PATH];
  delete require.cache[CONFIG_PATH];
  return require(SERVICE_PATH);
};

const stubYtDlp = (execImpl) => {
  delete require.cache[YTDLP_PATH];
  execSpy = execImpl;
  require.cache[YTDLP_PATH] = {
    id: YTDLP_PATH,
    filename: YTDLP_PATH,
    loaded: true,
    exports: {
      exec: execImpl,
      create: () => ({ exec: execImpl }),
    },
  };
};

beforeEach(() => {
  cache.flushAll();
  execSpy = null;
});

test("is disabled when YT_ENABLED=false and never spawns yt-dlp", async () => {
  stubYtDlp(() => {
    throw new Error("should not run");
  });
  process.env.YT_ENABLED = "false";
  try {
    const service = loadService();
    assert.strictEqual(service.isEnabled(), false);
    await assert.rejects(service.getTrackInfo("dQw4w9WgXcQ"), (err) => err.status === 503);
  } finally {
    delete process.env.YT_ENABLED;
    delete require.cache[SERVICE_PATH];
    delete require.cache[CONFIG_PATH];
  }
});

test("getTrackInfo resolves fields and caches per videoId", async () => {
  let execCount = 0;
  stubYtDlp((url, flags) => {
    execCount += 1;
    assert.match(url, /music\.youtube\.com\/watch\?v=/);
    assert.strictEqual(flags.dumpSingleJson, true);
    assert.strictEqual(flags.noPlaylist, true);
    return makeChild({
      exitCode: 0,
      stdout: JSON.stringify({
        id: "dQw4w9WgXcQ",
        title: "Test Song",
        duration: 213,
        ext: "webm",
        mime_type: "audio/webm; codecs=\"opus\"",
        thumbnail: "https://i.ytimg.com/x.jpg",
      }),
    });
  });

  const service = loadService();
  const first = await service.getTrackInfo("dQw4w9WgXcQ");
  const second = await service.getTrackInfo("dQw4w9WgXcQ");
  assert.strictEqual(first.id, "dQw4w9WgXcQ");
  assert.strictEqual(first.duration, 213);
  assert.strictEqual(first.contentType, "audio/webm");
  assert.strictEqual(first.thumbnail, "https://i.ytimg.com/x.jpg");
  assert.strictEqual(second.contentType, "audio/webm");
  assert.strictEqual(execCount, 1); // memoized
});

test("getTrackInfo maps a bot-check stderr to 403", async () => {
  stubYtDlp(() =>
    makeChild({
      exitCode: 1,
      stderr: "ERROR: Sign in to confirm you're not a bot",
    })
  );
  const service = loadService();
  await assert.rejects(
    service.getTrackInfo("dQw4w9WgXcQ"),
    (err) => err.status === 403 && /bot check/i.test(err.message)
  );
});

test("getTrackInfo maps unavailable videos to 404", async () => {
  stubYtDlp(() =>
    makeChild({
      exitCode: 1,
      stderr: "ERROR: [youtube] abc: Video unavailable",
    })
  );
  const service = loadService();
  await assert.rejects(service.getTrackInfo("dQw4w9WgXcQ"), (err) => err.status === 404);
});

test("getTrackInfo surfaces unmapped yt-dlp stderr instead of a bare exit code", async () => {
  stubYtDlp(() =>
    makeChild({
      exitCode: 1,
      stderr: "ERROR: [err] invalid cookie file\nERROR: cookies.txt has no valid cookies",
    })
  );
  const service = loadService();
  await assert.rejects(
    service.getTrackInfo("dQw4w9WgXcQ"),
    (err) => err.status === 502 && /invalid cookie file/.test(err.message)
  );
});

test("searchTrack returns the first ytsearch result and caches the query", async () => {
  let calls = [];
  stubYtDlp((url, flags) => {
    calls.push({ url, flags });
    return makeChild({
      exitCode: 0,
      stdout: JSON.stringify({
        entries: [
          {
            id: "YR12Z8f1Dh8",
            title: "Why This Kolaveri Di - Official Video",
            duration: 261,
            thumbnail: "https://i.ytimg.com/k.jpg",
          },
        ],
      }),
    });
  });
  const service = loadService();
  const hit = await service.searchTrack("why this kolaveri di");
  const hit2 = await service.searchTrack("why this kolaveri di");
  assert.strictEqual(hit.videoId, "YR12Z8f1Dh8");
  assert.ok(hit.name.includes("Kolaveri"));
  assert.strictEqual(hit.duration, 261);
  assert.strictEqual(hit.thumbnail, "https://i.ytimg.com/k.jpg");
  assert.strictEqual(hit2.videoId, "YR12Z8f1Dh8");
  assert.strictEqual(calls.length, 1); // memoized
  assert.match(calls[0].url, /^ytsearch1:/);
});

test("searchTrack returns null for an empty result set", async () => {
  stubYtDlp(() => makeChild({ exitCode: 0, stdout: JSON.stringify({ entries: [] }) }));
  const service = loadService();
  const hit = await service.searchTrack("nope not found anything");
  assert.strictEqual(hit, null);
});

test("search returns normalized track rows from a multi-entry ytsearch", async () => {
  let calls = [];
  stubYtDlp((url, flags) => {
    calls.push({ url, flags });
    return makeChild({
      exitCode: 0,
      stdout: JSON.stringify({
        entries: [
          {
            id: "V1",
            title: "Song One ",
            duration: 200,
            thumbnails: [{ url: "https://i.ytimg.com/t1.jpg" }, { url: "https://i.ytimg.com/t1max.jpg" }],
            channel: "Artist One",
          },
          {
            id: "V2",
            title: "Song Two",
            duration: 180,
            thumbnail: "https://i.ytimg.com/t2.jpg",
            uploader: "Artist Two",
          },
        ],
      }),
    });
  });
  const service = loadService();
  const out = await service.search("query", { type: "track", limit: 5 });

  assert.strictEqual(out.results.track.length, 2);
  assert.strictEqual(out.results.track[0].id, "V1");
  assert.strictEqual(out.results.track[0].source, "ytmusic");
  assert.strictEqual(out.results.track[0].name, "Song One"); // trailing space trimmed
  assert.strictEqual(out.results.track[0].artist_name, "Artist One");
  assert.strictEqual(out.results.track[0].audio, "/api/ytmusic/songs/V1/stream");
  assert.strictEqual(out.results.track[0].image, "https://i.ytimg.com/t1max.jpg");
  assert.strictEqual(out.results.track[1].artist_name, "Artist Two");
  assert.strictEqual(out.results.track[1].image, "https://i.ytimg.com/t2.jpg");
  assert.match(calls[0].url, /^ytsearch5:/);
  assert.strictEqual(calls[0].flags.noPlaylist, true);
  // Full format extraction is far too slow for multi-entry searches; flat
  // playlist mode keeps the dump cheap while still exposing title/duration.
  assert.strictEqual(calls[0].flags.flatPlaylist, true);

  // Memoized: repeating the query reuses the cached entries.
  await service.search("query", { type: "track", limit: 5 });
  assert.strictEqual(calls.length, 1);
});

test("search returns non-track rows from the innertube catalog without spawning yt-dlp", async () => {
  let ytCalls = 0;
  stubYtDlp(() => {
    ytCalls += 1;
    return makeChild({ exitCode: 0, stdout: "{}" });
  });

  // Non-track types no longer cost nothing: albums/playlists/artists are
  // searched via the youtubei innertube HTTP API (they have no yt-dlp facet),
  // so the axios client is mocked to keep the test hermetic.
  const col = (text) => ({ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text }] } } });
  const shelfItem = (row) => ({ itemSectionRenderer: { contents: [{ musicResponsiveListItemRenderer: row }] } });
  const data = {
    contents: {
      tabbedSearchResultsRenderer: {
        tabs: [{
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  shelfItem({
                    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/a.jpg", width: 544, height: 544 }] } } },
                    flexColumns: [
                      col("Q"),
                      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Album" }, { text: " • " }, { text: "Mr.Children" }, { text: " • " }, { text: "2000" }] } } },
                      col(""),
                    ],
                    navigationEndpoint: { browseEndpoint: { browseId: "MPREb_HcT2jz11xK4" } },
                  }),
                  shelfItem({
                    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/p.jpg", width: 544, height: 544 }] } } },
                    flexColumns: [
                      col("Q Playlist"),
                      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Playlist" }, { text: " • " }, { text: "YouTube Music" }, { text: " • " }, { text: "12 songs" }] } } },
                      col(""),
                    ],
                    navigationEndpoint: { browseEndpoint: { browseId: "VLRDCLAK5uy_kZGV6lZmVZGVo" } },
                  }),
                ],
              },
            },
          },
        }],
      },
    },
  };
  axiosMock.install();
  axiosMock.setHandler(() => Promise.resolve({ data }));
  try {
    const service = loadService();
    const out = await service.search("q", { type: "album,playlist", limit: 5 });
    assert.strictEqual(out.results.album.length, 1);
    assert.strictEqual(out.results.album[0].id, "MPREb_HcT2jz11xK4");
    assert.strictEqual(out.results.album[0].name, "Q");
    assert.strictEqual(out.results.playlist.length, 1);
    assert.strictEqual(out.results.playlist[0].track_count, 12);
    assert.strictEqual(out.results.playlist[0].id, "RDCLAK5uy_kZGV6lZmVZGVo");
    assert.strictEqual(ytCalls, 0);
  } finally {
    axiosMock.restore();
  }
});

test("spawnStream returns a child configured for raw audio output", async () => {
  let captured = null;
  stubYtDlp((url, flags) => {
    captured = { url, flags };
    return makeChild({});
  });
  const service = loadService();
  const child = service.spawnStream("dQw4w9WgXcQ");
  assert.strictEqual(captured.flags.output, "-");
  assert.strictEqual(captured.flags.format, "bestaudio[ext=m4a]/bestaudio/best");
  assert.match(captured.url, /watch\?v=dQw4w9WgXcQ/);
  assert.strictEqual(typeof child.stdout.pipe, "function");
});

test("spawnStream with an https:// proxy relaxes certificate verification", async () => {
  let captured;
  stubYtDlp((url, flags) => {
    captured = { url, flags };
    return makeChild({});
  });
  process.env.YT_PROXY = "https://res-any:pass@gw.proxyrise.com:443";
  try {
    const service = loadService();
    service.spawnStream("dQw4w9WgXcQ");
    assert.strictEqual(captured.flags.proxy, "https://res-any:pass@gw.proxyrise.com:443");
    assert.strictEqual(captured.flags.noCheckCertificate, true);
  } finally {
    delete process.env.YT_PROXY;
  }
});

test("circuit breaker opens after a streak of bot-checks and short-circuits", async () => {
  let calls = 0;
  stubYtDlp(() => {
    calls += 1;
    return makeChild({ exitCode: 1, stderr: "ERROR: Sign in to confirm you're not a bot" });
  });
  const service = loadService();
  for (let i = 0; i < 5; i++) {
    await assert.rejects(service.getTrackInfo(`aaaaaaaaaaa${i}`), (err) => err.status === 403);
  }
  assert.strictEqual(service.isBreakerOpen(), true);
  const callsBefore = calls;
  await assert.rejects(service.getTrackInfo("dQw4w9WgXcQ"), (err) => err.status === 503);
  assert.strictEqual(calls, callsBefore); // no new spawn while open
});

test("a missing binary maps to 502 without opening the breaker", async () => {
  stubYtDlp(() => {
    const err = new Error("spawn yt-dlp ENOENT");
    err.code = "ENOENT";
    throw err;
  });
  const service = loadService();
  await assert.rejects(service.getTrackInfo("dQw4w9WgXcQ"), (err) => {
    assert.strictEqual(err.status, 502);
    assert.strictEqual(err.binaryMissing, true);
    return true;
  });
  assert.strictEqual(service.isBreakerOpen(), false);
});

test("getStatus surfaces cookies config and counts bot checks (cookie expiry signal)", async () => {
  stubYtDlp(() =>
    makeChild({
      exitCode: 1,
      stderr: "ERROR: Sign in to confirm you're not a bot",
    })
  );
  process.env.YT_COOKIES_B64 = Buffer.from(
    "# Netscape HTTP Cookie File\nexample.com\tTRUE\t/\tFALSE\t0\tSID\tabc123\n",
    "utf8"
  ).toString("base64");
  try {
    const service = loadService();

    const before = service.getStatus();
    assert.strictEqual(before.enabled, true);
    assert.strictEqual(before.breakerOpen, false);
    assert.strictEqual(before.cookiesConfigured, true);
    assert.strictEqual(before.playerClient, "web_embedded");
    assert.strictEqual(before.botCheckCount, 0);
    assert.strictEqual(before.activeStreams, 0);

    await assert.rejects(service.getTrackInfo("dQw4w9WgXcQ"), (err) => err.status === 403);
    await assert.rejects(service.getTrackInfo("dQw4w9WgXcQ"), (err) => err.status === 403);

    const after = service.getStatus();
    assert.strictEqual(after.botCheckCount, 2);
    assert.ok(after.lastBotCheckAt, "lastBotCheckAt should be set after a 403");
  } finally {
    delete process.env.YT_COOKIES_B64;
    delete require.cache[SERVICE_PATH];
    delete require.cache[CONFIG_PATH];
  }
});

test("getStatus reports cookies absent when only YT_COOKIES_B64 is missing", async () => {
  stubYtDlp(() => makeChild({}));
  delete process.env.YT_COOKIES;
  delete process.env.YT_COOKIES_B64;
  const service = loadService();
  assert.strictEqual(service.getStatus().cookiesConfigured, false);
  assert.strictEqual(service.getStatus().playerClient, "");
  delete require.cache[SERVICE_PATH];
  delete require.cache[CONFIG_PATH];
});

test("spawnStream rejects with 429 when the concurrency cap is hit", async () => {
  const spawned = [];
  stubYtDlp((url, flags) => {
    const child = makeChild({});
    spawned.push(child);
    return child;
  });
  process.env.YT_MAX_CONCURRENCY = "1";
  try {
    const service = loadService();
    const first = service.spawnStream("dQw4w9WgXcQ");
    assert.ok(first);
    assert.throws(() => service.spawnStream("dQw4w9WgXcQ"), (err) => err.status === 429);
    // Releasing the first child frees a slot again.
    first.emit("close", 0);
    assert.ok(service.spawnStream("dQw4w9WgXcQ"));
  } finally {
    delete process.env.YT_MAX_CONCURRENCY;
    delete require.cache[SERVICE_PATH];
    delete require.cache[CONFIG_PATH];
  }
});