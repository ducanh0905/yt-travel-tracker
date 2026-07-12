// scripts/fetch-data.mjs
//
// Pulls stats for a list of YouTube channels (videos + stats + comments)
// and writes static JSON files into public/data/ so the frontend (hosted
// as a static site on Netlify) never needs to touch the YouTube API or an
// API key directly.
//
// Run locally:   YOUTUBE_API_KEY=xxx node scripts/fetch-data.mjs
// Run in CI:      see .github/workflows/fetch-data.yml
//
// Config via env vars (all optional):
//   MAX_VIDEOS_PER_CHANNEL   default 50   - how many most-recent videos to track per channel
//   MAX_COMMENTS_PER_VIDEO   default 100  - how many top-level comments to store per video
//   MAX_REPLIES_PER_COMMENT  default 20   - how many replies to store per top-level comment
//   COMMENT_ORDER            default "relevance" (or "time") - ignored when
//                            COMMENT_MAX_AGE_DAYS > 0, which forces "time" order
//   COMMENT_MAX_AGE_DAYS     default 90   - only keep comments newer than this many
//                            days (0 = no limit, keep all up to MAX_COMMENTS_PER_VIDEO).
//                            Also stops paginating as soon as older comments are hit,
//                            so this actually saves quota, not just storage.
//   FORCE_REFRESH_COMMENTS   default false - refetch comments even if commentCount unchanged
//   YOUTUBE_API_KEY          a single API key
//   YOUTUBE_API_KEYS         multiple API keys, comma-separated - used as automatic
//                            fallbacks: when one key hits its daily quota
//                            (quotaExceeded), the script switches to the next key
//                            and keeps going instead of failing the whole run.

import { readFile, writeFile, mkdir, readdir, unlink } from "fs/promises";
import path from "path";

const API_KEYS = (process.env.YOUTUBE_API_KEYS || process.env.YOUTUBE_API_KEY || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);
if (API_KEYS.length === 0) {
  console.error("Missing YOUTUBE_API_KEY or YOUTUBE_API_KEYS environment variable.");
  process.exit(1);
}
let apiKeyIndex = 0;
let keysExhausted = false; // true once every key has hit quotaExceeded

const MAX_VIDEOS_PER_CHANNEL = parseInt(process.env.MAX_VIDEOS_PER_CHANNEL || "50", 10);
const MAX_COMMENTS_PER_VIDEO = parseInt(process.env.MAX_COMMENTS_PER_VIDEO || "100", 10);
const MAX_REPLIES_PER_COMMENT = parseInt(process.env.MAX_REPLIES_PER_COMMENT || "20", 10);
const COMMENT_ORDER = process.env.COMMENT_ORDER || "relevance";
const COMMENT_MAX_AGE_DAYS = parseInt(process.env.COMMENT_MAX_AGE_DAYS || "90", 10); // 0 = no limit
const FORCE_REFRESH_COMMENTS = /^true$/i.test(process.env.FORCE_REFRESH_COMMENTS || "");

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const DATA_DIR = path.join(ROOT, "public", "data");
const COMMENTS_DIR = path.join(DATA_DIR, "comments");
const CHANNELS_FILE = path.join(ROOT, "channels.json");
const VIDEOS_FILE = path.join(DATA_DIR, "videos.json");
const META_FILE = path.join(DATA_DIR, "meta.json");

let quotaUnits = 0;
const API_BASE = "https://www.googleapis.com/youtube/v3";

async function apiGet(endpoint, params, cost = 1) {
  const url = new URL(`${API_BASE}/${endpoint}`);
  url.searchParams.set("key", API_KEYS[apiKeyIndex]);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  quotaUnits += cost;
  const json = await res.json();
  if (!res.ok) {
    const reason = json?.error?.errors?.[0]?.reason || res.status;
    const err = new Error(`${endpoint} failed: ${reason}`);
    err.reason = reason;
    err.status = res.status;
    throw err;
  }
  return json;
}

// Retries transient failures (network blips, 5xx, rate limiting) a couple of
// times before giving up, so a single hiccup mid-run doesn't silently leave
// a comment's replies empty. Also rotates to the next API key immediately
// when the current key hits its daily quota, instead of wasting retries on
// a key that's already exhausted.
async function apiGetWithRetry(endpoint, params, cost = 1, retries = 2) {
  let lastErr;
  let attempt = 0;
  while (attempt <= retries) {
    try {
      return await apiGet(endpoint, params, cost);
    } catch (err) {
      lastErr = err;
      if (err.reason === "quotaExceeded" || err.reason === "dailyLimitExceeded") {
        if (apiKeyIndex < API_KEYS.length - 1) {
          apiKeyIndex++;
          console.error(
            `    ! API key #${apiKeyIndex} bị hết quota, chuyển sang key #${apiKeyIndex + 1}...`
          );
          continue; // retry the same request on the new key, don't burn a retry attempt
        }
        keysExhausted = true;
        throw err;
      }
      // Don't retry permanent/expected failures like commentsDisabled or bad requests.
      const permanent = ["commentsDisabled", "commentThreadNotFound", "processingFailure"].includes(
        err.reason
      );
      attempt++;
      if (permanent || attempt > retries) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}

function extractChannelRef(rawInput) {
  let raw = rawInput.trim();
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // leave as-is if not valid percent-encoding
  }
  // Full URL forms
  const chMatch = raw.match(/youtube\.com\/channel\/([A-Za-z0-9_-]{10,})/);
  if (chMatch) return { type: "id", value: chMatch[1] };
  const handleMatch = raw.match(/youtube\.com\/@([^\/?&]+)/);
  if (handleMatch) return { type: "handle", value: "@" + handleMatch[1] };
  // Bare channel ID (starts with UC, 24 chars)
  if (/^UC[A-Za-z0-9_-]{22}$/.test(raw)) return { type: "id", value: raw };
  // Bare handle
  if (raw.startsWith("@")) return { type: "handle", value: raw };
  // Fallback: treat as handle
  return { type: "handle", value: "@" + raw.replace(/^@/, "") };
}

async function resolveChannel(raw) {
  const ref = extractChannelRef(raw);
  const params = { part: "snippet,statistics,contentDetails" };
  if (ref.type === "id") params.id = ref.value;
  else params.forHandle = ref.value;

  const json = await apiGetWithRetry("channels", params);
  const item = json.items?.[0];
  if (!item) throw new Error(`Channel not found for "${raw}"`);
  return {
    channelId: item.id,
    channelTitle: item.snippet.title,
    channelThumbnail: item.snippet.thumbnails?.default?.url || "",
    subscriberCount: item.statistics.hiddenSubscriberCount
      ? null
      : parseInt(item.statistics.subscriberCount || "0", 10),
    channelViewCount: parseInt(item.statistics.viewCount || "0", 10),
    channelVideoCount: parseInt(item.statistics.videoCount || "0", 10),
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
  };
}

async function getRecentVideoIds(uploadsPlaylistId, max) {
  const ids = [];
  let pageToken = "";
  while (ids.length < max) {
    const json = await apiGetWithRetry("playlistItems", {
      part: "contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: String(Math.min(50, max - ids.length)),
      ...(pageToken ? { pageToken } : {}),
    });
    for (const it of json.items || []) ids.push(it.contentDetails.videoId);
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return ids.slice(0, max);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getVideoStats(ids) {
  const results = [];
  for (const group of chunk(ids, 50)) {
    const json = await apiGetWithRetry("videos", {
      part: "snippet,statistics,contentDetails",
      id: group.join(","),
    });
    for (const v of json.items || []) {
      results.push({
        videoId: v.id,
        title: v.snippet.title,
        publishedAt: v.snippet.publishedAt,
        thumbnail:
          v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || "",
        viewCount: parseInt(v.statistics.viewCount || "0", 10),
        likeCount: v.statistics.likeCount !== undefined ? parseInt(v.statistics.likeCount, 10) : null,
        commentCount:
          v.statistics.commentCount !== undefined ? parseInt(v.statistics.commentCount, 10) : 0,
        duration: v.contentDetails.duration,
      });
    }
  }
  return results;
}

const replyErrors = [];

async function getReplies(parentId, max, videoId) {
  // commentThreads only embeds a small preview of replies for some orders,
  // so fetch explicitly via comments.list to get a consistent set.
  const replies = [];
  let pageToken = "";
  try {
    while (replies.length < max) {
      const json = await apiGetWithRetry("comments", {
        part: "snippet",
        parentId,
        maxResults: String(Math.min(100, max - replies.length)),
        textFormat: "plainText",
        ...(pageToken ? { pageToken } : {}),
      });
      for (const item of json.items || []) {
        const s = item.snippet;
        replies.push({
          id: item.id,
          author: s.authorDisplayName,
          authorImage: s.authorProfileImageUrl,
          text: s.textDisplay,
          likeCount: s.likeCount || 0,
          publishedAt: s.publishedAt,
        });
      }
      if (!json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }
  } catch (err) {
    // Don't fail the whole run if replies can't be fetched for one comment -
    // but do record it so it's visible in meta.json instead of only in logs.
    console.error(`    ! Failed replies for comment ${parentId}: ${err.message}`);
    replyErrors.push({ videoId, commentId: parentId, error: err.message });
  }
  // Replies come back newest-first from the API; show oldest-first like YouTube does.
  return replies.reverse();
}

async function getComments(videoId, max, order, maxRepliesPerComment, maxAgeDays) {
  const comments = [];
  let pageToken = "";
  // If we're only keeping recent comments, we MUST fetch newest-first ("time")
  // so we can stop paginating as soon as we hit a comment older than the
  // cutoff - that's what actually saves quota, not just filtering afterwards.
  const effectiveOrder = maxAgeDays > 0 ? "time" : order;
  const cutoff = maxAgeDays > 0 ? Date.now() - maxAgeDays * 24 * 60 * 60 * 1000 : null;
  try {
    outer: while (comments.length < max) {
      const json = await apiGetWithRetry("commentThreads", {
        part: "snippet",
        videoId,
        maxResults: String(Math.min(100, max - comments.length)),
        order: effectiveOrder,
        textFormat: "plainText",
        ...(pageToken ? { pageToken } : {}),
      });
      for (const item of json.items || []) {
        const top = item.snippet.topLevelComment.snippet;
        if (cutoff !== null && new Date(top.publishedAt).getTime() < cutoff) {
          // Newest-first order: once we hit one comment older than the
          // cutoff, everything after it is older too - stop entirely.
          break outer;
        }
        const replyCount = item.snippet.totalReplyCount || 0;
        const replies =
          replyCount > 0 && maxRepliesPerComment > 0
            ? await getReplies(item.id, maxRepliesPerComment, videoId)
            : [];
        comments.push({
          id: item.id,
          author: top.authorDisplayName,
          authorImage: top.authorProfileImageUrl,
          text: top.textDisplay,
          likeCount: top.likeCount || 0,
          publishedAt: top.publishedAt,
          replyCount,
          replies,
        });
      }
      if (!json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }
  } catch (err) {
    if (err.reason === "commentsDisabled") {
      return { disabled: true, comments: [] };
    }
    throw err;
  }
  return { disabled: false, comments };
}

async function loadPreviousVideos() {
  try {
    const raw = await readFile(VIDEOS_FILE, "utf-8");
    const arr = JSON.parse(raw);
    const map = new Map();
    for (const v of arr) map.set(v.videoId, v);
    return map;
  } catch {
    return new Map();
  }
}

async function main() {
  await mkdir(COMMENTS_DIR, { recursive: true });

  const rawChannels = JSON.parse(await readFile(CHANNELS_FILE, "utf-8"));
  const previousVideos = await loadPreviousVideos();

  const allVideos = [];
  const errors = [];

  for (const rawChannel of rawChannels) {
    try {
      console.log(`\n=== Channel: ${rawChannel} ===`);
      const channel = await resolveChannel(rawChannel);
      console.log(`Resolved: ${channel.channelTitle} (${channel.channelId})`);

      const videoIds = await getRecentVideoIds(channel.uploadsPlaylistId, MAX_VIDEOS_PER_CHANNEL);
      console.log(`Found ${videoIds.length} videos`);

      const stats = await getVideoStats(videoIds);

      for (const v of stats) {
        allVideos.push({
          ...v,
          channelId: channel.channelId,
          channelTitle: channel.channelTitle,
          channelThumbnail: channel.channelThumbnail,
          subscriberCount: channel.subscriberCount,
          channelViewCount: channel.channelViewCount,
          channelVideoCount: channel.channelVideoCount,
        });

        const prev = previousVideos.get(v.videoId);
        const needsCommentRefresh =
          FORCE_REFRESH_COMMENTS ||
          !prev ||
          prev.commentCount !== v.commentCount;

        if (!needsCommentRefresh) {
          console.log(`  - ${v.videoId} comments unchanged, skipping`);
          continue;
        }

        try {
          const { disabled, comments } = await getComments(
            v.videoId,
            MAX_COMMENTS_PER_VIDEO,
            COMMENT_ORDER,
            MAX_REPLIES_PER_COMMENT,
            COMMENT_MAX_AGE_DAYS
          );
          await writeFile(
            path.join(COMMENTS_DIR, `${v.videoId}.json`),
            JSON.stringify({ videoId: v.videoId, disabled, comments }, null, 2)
          );
          console.log(`  - ${v.videoId} fetched ${comments.length} comments${disabled ? " (disabled)" : ""}`);
        } catch (err) {
          console.error(`  ! Failed comments for ${v.videoId}: ${err.message}`);
          errors.push({ videoId: v.videoId, error: err.message });
        }
      }
    } catch (err) {
      console.error(`! Failed channel "${rawChannel}": ${err.message}`);
      errors.push({ channel: rawChannel, error: err.message });
    }
  }

  // Prune comment files for videos no longer tracked
  try {
    const trackedIds = new Set(allVideos.map((v) => v.videoId));
    const existingFiles = await readdir(COMMENTS_DIR);
    for (const file of existingFiles) {
      const id = file.replace(/\.json$/, "");
      if (!trackedIds.has(id)) {
        await unlink(path.join(COMMENTS_DIR, file));
      }
    }
  } catch {
    // ignore
  }

  allVideos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  await writeFile(VIDEOS_FILE, JSON.stringify(allVideos, null, 2));
  await writeFile(
    META_FILE,
    JSON.stringify(
      {
        lastUpdated: new Date().toISOString(),
        channelCount: rawChannels.length,
        videoCount: allVideos.length,
        quotaUnitsUsed: quotaUnits,
        apiKeysConfigured: API_KEYS.length,
        allKeysExhausted: keysExhausted,
        errors,
        replyErrors,
      },
      null,
      2
    )
  );

  console.log(`\nDone. Videos: ${allVideos.length}. Estimated quota units used: ${quotaUnits}.`);
  if (errors.length) {
    console.log(`Completed with ${errors.length} error(s) - see meta.json`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
