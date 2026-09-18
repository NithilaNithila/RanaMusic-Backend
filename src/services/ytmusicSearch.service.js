// Lightweight YouTube Music track search via the public innertube (youtubei)
// JSON API — no yt-dlp, no cookies, no proxy. Same WEB_REMIX client the
// music.youtube.com web app uses: a single POST returns document-ordered
// `musicResponsiveListItemRenderer` rows, which we map to RanaMusic track rows
// carrying the source-of-truth `videoId` (id = videoId). The browser later
// embeds that id (`youtube.com/embed/<videoId>`) instead of the backend
// streaming bytes, so streaming is 100% client-side and bot-free.
const axios = require("axios");
const { httpAgent, httpsAgent } = require("../config/http");
const { memoize, makeCacheKey } = require("./cache.service");

const YTM_ORIGIN = "https://music.youtube.com";
const YTM_INNERTUBE_SERVER = "https://music.youtube.com/youtubei/v1/";
const SEARCH_TTL = 600;

const CLIENT_VERSION = process.env.YTM_INNERTUBE_VERSION || "1.20240723.01.00";

const client = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 15000,
  headers: {
    "content-type": "application/json",
    "user-agent":
      process.env.YTM_INNERTUBE_UA ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    accept: "*/*",
  },
});

const innertubePost = (endpoint, body) =>
  client
    .post(
      `${YTM_INNERTUBE_SERVER}${endpoint}`,
      {
        context: {
          client: {
            clientName: "WEB_REMIX",
            clientVersion: CLIENT_VERSION,
            hl: "en",
            gl: "US",
          },
        },
        ...body,
      },
      { params: { prettyPrint: false } }
    )
    .then((r) => r.data);

// ── innertube search-row mapping helpers ─────────────────────────────
// All logic reads musicResponsiveListItem renderers the same way the YTMusic
// web client does: flexColumns hold title + the "•"-joined tag line, the
// thumbnail carries the artwork, fixedColumns the duration, and the videoId
// lives in either videoId, playlistItemData, or the watch/play nav endpoint.
const searchTabContents = (data) =>
  data &&
  data.contents &&
  data.contents.tabbedSearchResultsRenderer &&
  data.contents.tabbedSearchResultsRenderer.tabs &&
  data.contents.tabbedSearchResultsRenderer.tabs[0] &&
  data.contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer &&
  data.contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content &&
  data.contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer &&
  data.contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents;

const collectRows = (node, out = [], seen = new Set()) => {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) collectRows(n, out, seen);
    return out;
  }
  if (node.musicResponsiveListItemRenderer) {
    const renderer = node.musicResponsiveListItemRenderer;
    if (renderer && !seen.has(renderer)) {
      seen.add(renderer);
      out.push(renderer);
    }
  }
  for (const k of Object.keys(node)) collectRows(node[k], out, seen);
  return out;
};

const flexText = (row, i) =>
  ((row.flexColumns || [])[i] &&
    (row.flexColumns[i].musicResponsiveListItemFlexColumnRenderer || {}).text &&
    ((row.flexColumns[i].musicResponsiveListItemFlexColumnRenderer.text || {}).runs || [])
      .map((r) => r.text || "")
      .join("")
      .trim()) ||
  "";

const segs = (row, i) => flexText(row, i).split("•").map((s) => s.trim());

const rowKind = (row) => String(segs(row, 1)[0] || "").toLowerCase();

const imageOf = (row) => {
  const t =
    row.thumbnail &&
    row.thumbnail.musicThumbnailRenderer &&
    row.thumbnail.musicThumbnailRenderer.thumbnail &&
    row.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails;
  return Array.isArray(t) && t.length ? t[t.length - 1].url || "" : "";
};

const durationToSeconds = (text) => {
  const m = String(text || "").match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return m[1] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[2]) * 60 + Number(m[3]);
};

const rowDuration = (row) => {
  const runs =
    ((row.fixedColumns || [])[0] &&
      (((row.fixedColumns[0].musicResponsiveListItemFixedColumnRenderer || {}).text || {}).runs)) ||
    [];
  return durationToSeconds(runs.map((r) => r.text || "").join(""));
};

const videoIdOf = (row) =>
  row.videoId ||
  (row.playlistItemData && row.playlistItemData.videoId) ||
  (row.navigationEndpoint &&
    row.navigationEndpoint.watchEndpoint &&
    row.navigationEndpoint.watchEndpoint.videoId) ||
  (row.navigationEndpoint &&
    row.navigationEndpoint.playNavigationEndpoint &&
    row.navigationEndpoint.playNavigationEndpoint.watchEndpoint &&
    row.navigationEndpoint.playNavigationEndpoint.watchEndpoint.videoId) ||
  // Browse pages (album/playlist tracklists) don't put the id on the row:
  // the title run and the play-overlay button both carry a watchEndpoint.
  (row.flexColumns &&
    row.flexColumns[0] &&
    row.flexColumns[0].musicResponsiveListItemFlexColumnRenderer &&
    row.flexColumns[0].musicResponsiveListItemFlexColumnRenderer.text &&
    row.flexColumns[0].musicResponsiveListItemFlexColumnRenderer.text.runs &&
    row.flexColumns[0].musicResponsiveListItemFlexColumnRenderer.text.runs[0] &&
    row.flexColumns[0].musicResponsiveListItemFlexColumnRenderer.text.runs[0].navigationEndpoint &&
    row.flexColumns[0].musicResponsiveListItemFlexColumnRenderer.text.runs[0].navigationEndpoint.watchEndpoint &&
    row.flexColumns[0].musicResponsiveListItemFlexColumnRenderer.text.runs[0].navigationEndpoint.watchEndpoint.videoId) ||
  (row.overlay &&
    row.overlay.musicItemThumbnailOverlayRenderer &&
    row.overlay.musicItemThumbnailOverlayRenderer.content &&
    row.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer &&
    row.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint &&
    row.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint &&
    row.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint.videoId) ||
  "";

const watchUrl = (videoId) => `${YTM_ORIGIN}/watch?v=${videoId}`;

// Maps one song row to a RanaMusic track row. audio stays empty by design: the
// embed (browser-side) plays the video; the resolver can still fill a full
// playable Saavn copy later when one exists.
const normalizeTrackRow = (row) => {
  const videoId = videoIdOf(row);
  const name = flexText(row, 0);
  if (!videoId || !name) return null;
  const seg = segs(row, 1);
  return {
    id: videoId,
    videoId,
    name,
    type: "track",
    source: "ytmusic",
    artist_name: seg[1] || flexText(row, 2) || "",
    album_name: "",
    album_id: "",
    image: imageOf(row),
    audio: "",
    duration: rowDuration(row),
    year: "",
    play_count: "",
    language: "",
    url: watchUrl(videoId),
    has_lyrics: false,
  };
};

const clampLimit = (limit) => Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
const clampOffset = (offset) => Math.max(parseInt(offset, 10) || 0, 0);

// Multi-result YouTube Music TRACK search. Only song-kind rows (videoId + a
// "Song" tag) are kept; artist/album/playlist shelves are out of scope for the
// iframe-embed feature. Defensive: any unexpected response shape yields [].
const searchTracks = (query, opts = {}) => {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  const q = String(query || "").trim();
  if (!q) return Promise.resolve({ total: 0, results: { track: [] } });

  return memoize(makeCacheKey("yt:search:list", { q, limit, offset }), SEARCH_TTL, async () => {
    try {
      const data = await innertubePost("search", { query: q });
      const rows = collectRows(searchTabContents(data)) || [];
      const songs = [];
      for (const row of rows) {
        if (rowKind(row) !== "song") continue;
        const item = normalizeTrackRow(row);
        if (item && item.videoId) {
          songs.push(item);
          if (songs.length >= offset + limit) break;
        }
      }
      const slice = songs.slice(offset, offset + limit);
      return { total: songs.length, results: { track: slice } };
    } catch {
      // Unreachable/bot-checked — contribute nothing; the unified search
      // back-fills the ytmusic tab from Saavn and the resolver stays Saavn-only.
      return { total: 0, results: { track: [] } };
    }
  });
};

// Single best song row for a query (used by the resolver as the last-resort
// videoId when Saavn has no playable copy). Returns null when nothing matches.
const findTrack = (query) => {
  const q = String(query || "").trim();
  if (!q) return Promise.resolve(null);
  return memoize(makeCacheKey("yt:search:single", { q }), SEARCH_TTL, async () => {
    try {
      const data = await innertubePost("search", { query: q });
      const rows = collectRows(searchTabContents(data)) || [];
      for (const row of rows) {
        if (rowKind(row) !== "song") continue;
        const item = normalizeTrackRow(row);
        if (item && item.videoId) return item;
      }
      return null;
    } catch {
      return null;
    }
  });
};

// ── album & playlist search ─────────────────────────────────────────
// The same innertube `search` response carries Album/Playlist rows (their
// second flex column reads "Album • 2026" / "Playlist • … • 50 songs"). Both
// normalizers use the row's browseId (MPREb_… / VL…) as the stable id so the
// detail page can hand it straight back to the `browse` endpoint.

const innertubeSearchRows = async (q) => {
  const data = await innertubePost("search", { query: q });
  return collectRows(searchTabContents(data)) || [];
};

const overlayPlaylistId = (row) => {
  const content = ((row.overlay || {}).musicItemThumbnailOverlayRenderer || {}).content;
  const ep = content && content.musicPlayButtonRenderer && content.musicPlayButtonRenderer.playNavigationEndpoint;
  return (ep && ep.watchPlaylistEndpoint && ep.watchPlaylistEndpoint.playlistId) || "";
};

const normalizeAlbumRow = (row) => {
  const name = flexText(row, 0);
  if (!name) return null;
  const kind = rowKind(row);
  if (!/^(album|single|ep)$/i.test(kind)) return null;
  const nav = row.navigationEndpoint || {};
  const browseId = nav.browseEndpoint && nav.browseEndpoint.browseId;
  const id = browseId || overlayPlaylistId(row);
  if (!id) return null;
  const seg = segs(row, 1);
  const year = seg.find((s) => /^(19|20)\d{2}$/.test(s)) || "";
  const artist_name = flexText(row, 2) || "";
  return {
    id,
    name,
    type: "album",
    source: "ytmusic",
    artist_name,
    year,
    song_count: "",
    image: imageOf(row),
    audio: "",
    url: `${YTM_ORIGIN}/browse/${id}`,
    has_lyrics: false,
  };
};

const normalizePlaylistRow = (row) => {
  const name = flexText(row, 0);
  if (!name) return null;
  if (rowKind(row) !== "playlist") return null;
  const nav = row.navigationEndpoint || {};
  const browseId = nav.browseEndpoint && nav.browseEndpoint.browseId;
  const playlistId = nav.playlistEndpoint && nav.playlistEndpoint.playlistId;
  const id = browseId || playlistId || overlayPlaylistId(row);
  if (!id) return null;
  const seg = segs(row, 1);
  const countText = seg.join(" • ").match(/(\d[\d,]*)\s*(?:songs?|tracks?)/i);
  return {
    id,
    name,
    type: "playlist",
    source: "ytmusic",
    track_count: countText ? countText[1].replace(/,/g, "") : "",
    image: imageOf(row),
    url: `${YTM_ORIGIN}/browse/${id}`,
  };
};

// Filters one `search` response's rows by kind, then slices the requested
// page. Never throws: unreachable/bot-checked upstreams contribute nothing and
// the unified search back-fills from Saavn.
const searchAlbums = (query, opts = {}) => {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  const q = String(query || "").trim();
  if (!q) return Promise.resolve({ total: 0, results: { album: [] } });

  return memoize(makeCacheKey("yt:search:album", { q, limit, offset }), SEARCH_TTL, async () => {
    try {
      const rows = await innertubeSearchRows(q);
      const items = [];
      for (const row of rows) {
        const item = normalizeAlbumRow(row);
        if (item && item.id) {
          items.push(item);
          if (items.length >= offset + limit) break;
        }
      }
      return { total: items.length, results: { album: items.slice(offset, offset + limit) } };
    } catch {
      return { total: 0, results: { album: [] } };
    }
  });
};

const searchPlaylists = (query, opts = {}) => {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  const q = String(query || "").trim();
  if (!q) return Promise.resolve({ total: 0, results: { playlist: [] } });

  return memoize(makeCacheKey("yt:search:playlist", { q, limit, offset }), SEARCH_TTL, async () => {
    try {
      const rows = await innertubeSearchRows(q);
      const items = [];
      for (const row of rows) {
        const item = normalizePlaylistRow(row);
        if (item && item.id) {
          items.push(item);
          if (items.length >= offset + limit) break;
        }
      }
      return { total: items.length, results: { playlist: items.slice(offset, offset + limit) } };
    } catch {
      return { total: 0, results: { playlist: [] } };
    }
  });
};

// Uniform multi-type search mirroring spotify.service.search so the catalog /
// discover feeds can treat YouTube Music like any other provider.
const SEARCH_TYPES = ["track", "album", "playlist"];

const search = async (query, opts = {}) => {
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);
  const requested = String(opts.type || "track")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => SEARCH_TYPES.includes(t));
  const types = opts.type === "all" ? SEARCH_TYPES : requested.length ? requested : ["track"];

  const results = {};
  let total = 0;
  await Promise.allSettled(
    types.map(async (type) => {
      let data = null;
      if (type === "track") data = await searchTracks(query, { limit, offset });
      else if (type === "album") data = await searchAlbums(query, { limit, offset });
      else if (type === "playlist") data = await searchPlaylists(query, { limit, offset });
      const rows = (data && data.results && data.results[type]) || [];
      results[type] = rows;
      total += rows.length;
    })
  );
  for (const type of types) {
    if (!results[type]) results[type] = [];
  }
  return { total, results };
};

// ── album & playlist detail (browse) ────────────────────────────────
// `browse` returns the header (musicResponsiveHeaderRenderer /
// musicDetailHeaderRenderer) plus the track list. Song rows on these pages
// carry their videoId only in the title-run/overlay (see videoIdOf), so both
// detail endpoints map rows straight to playable-in-embed track rows.

const runsText = (o) => ((o && o.runs) || []).map((r) => r.text || "").join("").trim();

const browseHeader = (data) => {
  let header = null;
  const walk = (node) => {
    if (!node || typeof node !== "object" || header) return;
    if (node.musicResponsiveHeaderRenderer || node.musicDetailHeaderRenderer) {
      header = node.musicResponsiveHeaderRenderer || node.musicDetailHeaderRenderer;
      return;
    }
    for (const k of Object.keys(node)) walk(node[k]);
  };
  walk(data);
  if (!header) return {};

  const thumbnail = header.thumbnail && header.thumbnail.musicThumbnailRenderer && header.thumbnail.musicThumbnailRenderer.thumbnail && header.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails;
  const image = Array.isArray(thumbnail) && thumbnail.length ? thumbnail[thumbnail.length - 1].url || "" : "";
  const subtitle = runsText(header.subtitle || "");
  const parts = subtitle.split("•").map((s) => s.trim()).filter(Boolean);
  const typeWord = parts[0] || "";
  const isTypeWord = /^(album|single|ep|playlist|song|video)$/i.test(typeWord);
  const artist_name = runsText(header.straplineTextOne || "") || (isTypeWord ? parts[1] || "" : typeWord);

  return {
    title: runsText(header.title || ""),
    subtitle,
    artist_name,
    year: parts.find((p) => /^(19|20)\d{2}$/.test(p)) || "",
    image,
  };
};

// Collects the first shelf (musicPlaylistShelfRenderer for playlists,
// musicShelfRenderer for albums) that actually holds responsive rows.
const shelfRows = (data) => {
  let rows = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (!rows.length && (node.musicShelfRenderer || node.musicPlaylistShelfRenderer)) {
      const shelf = node.musicPlaylistShelfRenderer || node.musicShelfRenderer;
      const container = shelf.musicPlaylistShelfRenderer || shelf;
      const items = ((container.contents || []).filter((c) => c && c.musicResponsiveListItemRenderer) || []).map((c) => c.musicResponsiveListItemRenderer);
      if (items.length) rows = items;
    }
    for (const k of Object.keys(node)) walk(node[k]);
  };
  walk(data);
  return rows;
};

const rowToTrack = (row, albumTitle, albumId) => {
  const videoId = videoIdOf(row);
  const name = flexText(row, 0);
  if (!videoId || !name) return null;
  return {
    id: videoId,
    videoId,
    name,
    type: "track",
    source: "ytmusic",
    artist_name: flexText(row, 1) || "",
    album_name: albumTitle || "",
    album_id: albumId || "",
    image: imageOf(row),
    audio: "",
    duration: rowDuration(row),
    year: "",
    play_count: "",
    language: "",
    url: watchUrl(videoId),
    has_lyrics: false,
  };
};

const getAlbumById = (id) => {
  const key = makeCacheKey("yt:album", { id });
  return memoize(key, SEARCH_TTL, async () => {
    try {
      const data = await innertubePost("browse", { browseId: id });
      const header = browseHeader(data);
      const songs = shelfRows(data).map((row) => rowToTrack(row, header.title || "", id)).filter(Boolean);
      return {
        id,
        name: header.title || "",
        type: "album",
        source: "ytmusic",
        artist_name: header.artist_name || "",
        year: header.year || "",
        image: header.image || (songs[0] && songs[0].image) || "",
        song_count: songs.length,
        songs,
        url: `${YTM_ORIGIN}/browse/${id}`,
      };
    } catch {
      return null;
    }
  });
};

const getPlaylistById = (id) => {
  const key = makeCacheKey("yt:playlist", { id });
  return memoize(key, SEARCH_TTL, async () => {
    try {
      // Search rows hand out playlist ids as VL…, but a client may pass the
      // bare id — browse only accepts the full dispatch id.
      const browseId = /^VL/i.test(id) ? id : `VL${id}`;
      const data = await innertubePost("browse", { browseId });
      const header = browseHeader(data);
      const songs = shelfRows(data).map((row) => rowToTrack(row, "", "")).filter(Boolean);
      return {
        id,
        name: header.title || "",
        type: "playlist",
        source: "ytmusic",
        track_count: songs.length,
        image: header.image || (songs[0] && songs[0].image) || "",
        songs,
        url: `${YTM_ORIGIN}/browse/${id}`,
      };
    } catch {
      return null;
    }
  });
};

module.exports = {
  searchTracks,
  findTrack,
  searchAlbums,
  searchPlaylists,
  search,
  getAlbumById,
  getPlaylistById,
  searchTabContents,
  collectRows,
  videoIdOf,
};