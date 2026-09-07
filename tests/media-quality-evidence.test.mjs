import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Quality, codec evidence and proven playback are three different claims.
 *
 * They used to be one ranking. Bitrate was read before resolution and an absent bitrate was read
 * as zero, so a 1080p rendition that carried no bitrate lost to a 480p one that did: a smaller
 * picture chosen because of an absence. A codec name is the same trap in another field -- X ships
 * a declared AVC stream inside containers browsers refuse, and omits the field entirely on plenty
 * of renditions that play fine, so a name is evidence about a stream and never a measure of it.
 */

const AVC = "avc1.640028";

function variant(overrides) {
  return {
    url: "https://video.twimg.com/amplify_video/1/vid/1280x720/x.mp4",
    type: "video/mp4",
    width: null,
    height: null,
    bitrate: null,
    ...overrides
  };
}

test("a higher resolution wins even when only the smaller rendition names a codec", async () => {
  const { pickPreferred } = await importSourceModule("src/features/media/video-extract.ts");

  const big = variant({
    url: "https://video.twimg.com/amplify_video/1/vid/1920x1080/big.mp4",
    width: 1920,
    height: 1080
  });
  const small = variant({
    url: "https://video.twimg.com/amplify_video/1/vid/854x480/small.mp4",
    width: 854,
    height: 480,
    bitrate: 950_000,
    codec: AVC,
    codecSource: "graphql-variant"
  });

  // Both orderings, because a comparator that reads its inputs in the wrong order can still get
  // one of them right by accident.
  assert.equal(pickPreferred([big, small]).url, big.url);
  assert.equal(pickPreferred([small, big]).url, big.url);
});

test("an absent bitrate is absent, not zero", async () => {
  const { pickPreferred, compareVariantQuality } = await importSourceModule(
    "src/features/media/video-extract.ts"
  );

  const big = variant({
    url: "https://video.twimg.com/amplify_video/1/vid/1920x1080/big.mp4",
    width: 1920,
    height: 1080
  });
  // A bitrate X reported that does not describe this file. It must not buy a smaller picture.
  const inaccurate = variant({
    url: "https://video.twimg.com/amplify_video/1/vid/1280x720/wrong-bitrate.mp4",
    width: 1280,
    height: 720,
    bitrate: 40_000_000
  });

  assert.equal(pickPreferred([inaccurate, big]).url, big.url);
  assert.ok(compareVariantQuality(big, inaccurate) > 0, "1080p must rank above 720p");

  // Bitrate still decides between two renditions that both declared one at the same resolution.
  const lower = variant({ url: "https://video.twimg.com/a/lo.mp4", width: 1280, height: 720, bitrate: 1_000_000 });
  const higher = variant({ url: "https://video.twimg.com/a/hi.mp4", width: 1280, height: 720, bitrate: 3_000_000 });
  assert.ok(compareVariantQuality(higher, lower) > 0);
  assert.equal(pickPreferred([lower, higher]).url, higher.url);

  // And a rendition that measured its resolution outranks one that did not, in both directions.
  const unmeasured = variant({ url: "https://video.twimg.com/a/unknown.mp4", bitrate: 9_000_000 });
  assert.ok(compareVariantQuality(lower, unmeasured) > 0);
  assert.ok(compareVariantQuality(unmeasured, lower) < 0);
});

test("a named codec in a container this build cannot save never wins", async () => {
  const { pickPreferred } = await importSourceModule("src/features/media/video-extract.ts");

  // A defective container: the stream names AVC and claims the highest resolution, but it is an
  // HLS playlist, and saving one produces a text file rather than a video.
  const defective = variant({
    url: "https://video.twimg.com/amplify_video/1/pl/playlist.m3u8",
    type: "application/x-mpegURL",
    width: 3840,
    height: 2160,
    bitrate: 20_000_000,
    codec: AVC,
    codecSource: "graphql-variant"
  });
  const playable = variant({
    url: "https://video.twimg.com/amplify_video/1/vid/1280x720/ok.mp4",
    width: 1280,
    height: 720
  });

  assert.equal(pickPreferred([defective, playable]).url, playable.url);
});

test("equal renditions resolve by a stable rule, not by arrival order", async () => {
  const { pickPreferred } = await importSourceModule("src/features/media/video-extract.ts");
  const first = variant({ url: "https://video.twimg.com/a/aaa.mp4", width: 1280, height: 720 });
  const second = variant({ url: "https://video.twimg.com/a/bbb.mp4", width: 1280, height: 720 });

  assert.equal(pickPreferred([first, second]).url, pickPreferred([second, first]).url);
});

test("playback is observed from the element, and does not travel with a codec name", async () => {
  const { extractVideo } = await importSourceModule("src/features/media/video-extract.ts");

  const played = "https://video.twimg.com/amplify_video/1/vid/1280x720/played.mp4";
  const extracted = extractVideo(
    fakeContainer({
      currentSrc: played,
      readyState: 2,
      sources: [{ src: played, type: "video/mp4" }]
    }),
    {
      variants: [
        {
          url: played,
          type: "video/mp4",
          width: 1280,
          height: 720,
          bitrate: null
        },
        {
          url: "https://video.twimg.com/amplify_video/1/vid/1920x1080/named.mp4",
          type: "video/mp4",
          width: 1920,
          height: 1080,
          bitrate: null,
          codec: AVC
        }
      ]
    }
  );

  assert.ok(extracted, "no video extracted");
  const byUrl = new Map(extracted.variants.map((entry) => [entry.url, entry]));

  const observed = byUrl.get(played);
  assert.equal(observed.playbackObserved, true, "the element decoded a frame from this exact URL");
  assert.equal(observed.codec ?? null, null, "playing is not a codec claim");

  const named = byUrl.get("https://video.twimg.com/amplify_video/1/vid/1920x1080/named.mp4");
  assert.equal(named.codec, AVC);
  assert.equal(named.codecSource, "graphql-variant", "a codec name carries where it came from");
  assert.notEqual(named.playbackObserved, true, "a codec name is not evidence of playback");

  // And the named rendition still wins on resolution, which is the only quality measure here.
  assert.equal(extracted.preferred.url, named.url);
});

test("a codec read off a source element is attributed to the source element", async () => {
  const { extractVideo } = await importSourceModule("src/features/media/video-extract.ts");
  const extracted = extractVideo(
    fakeContainer({
      sources: [
        {
          src: "https://video.twimg.com/amplify_video/1/vid/1280x720/from-dom.mp4",
          type: "video/mp4",
          dataset: { codec: AVC, width: "1280", height: "720" }
        }
      ]
    })
  );

  assert.ok(extracted);
  assert.equal(extracted.variants[0].codec, AVC);
  assert.equal(extracted.variants[0].codecSource, "source-element");
});

test("merging two observations of one URL keeps the evidence attached to its source", async () => {
  const { mergeVideoVariant } = await importSourceModule("src/features/media/video-extract.ts");

  const url = "https://video.twimg.com/amplify_video/1/vid/1280x720/same.mp4";
  const fromDom = { url, type: "video/mp4", width: 1280, height: 720, bitrate: null, playbackObserved: true };
  const fromGraph = {
    url,
    type: "video/mp4",
    width: null,
    height: null,
    bitrate: 2_000_000,
    codec: AVC,
    codecSource: "graphql-variant"
  };

  for (const merged of [mergeVideoVariant(fromDom, fromGraph), mergeVideoVariant(fromGraph, fromDom)]) {
    assert.equal(merged.width, 1280);
    assert.equal(merged.bitrate, 2_000_000);
    assert.equal(merged.codec, AVC);
    assert.equal(merged.codecSource, "graphql-variant", "the codec kept the source that declared it");
    assert.equal(merged.playbackObserved, true, "one observation of playback is enough");
  }
});

test("a download receipt keeps codec evidence, measured quality and playback apart", async () => {
  const { normalizeDownloadQuality, unknownDownloadQuality } = await importSourceModule(
    "src/extension/download-state.ts"
  );

  const full = normalizeDownloadQuality({
    label: "best-direct",
    width: 1280,
    height: 720,
    bitrate: 2_176_000,
    mime: "video/mp4",
    codec: AVC,
    codecSource: "graphql-variant",
    playbackProven: true
  });
  assert.deepEqual(full, {
    label: "best-direct",
    width: 1280,
    height: 720,
    bitrate: 2_176_000,
    mime: "video/mp4",
    codec: AVC,
    codecSource: "graphql-variant",
    playbackProven: true
  });

  // A codec name with nothing behind it is not evidence, so it is not kept.
  const unattributed = normalizeDownloadQuality({
    label: "best-direct",
    width: 1280,
    height: 720,
    mime: "video/mp4",
    codec: AVC
  });
  assert.equal(unattributed.codec, null);
  assert.equal(unattributed.codecSource, null);
  assert.equal(unattributed.width, 1280, "dropping the codec must not drop the measurement");

  // Playback is never inferred from anything else.
  assert.equal(unattributed.playbackProven, false);
  assert.equal(unknownDownloadQuality().playbackProven, false);
  assert.equal(unknownDownloadQuality().codec, null);
});

test("history written before codec evidence existed stays codec unknown", async () => {
  const { MediaHistory, MEDIA_HISTORY_SCHEMA_VERSION } = await importSourceModule(
    "src/features/media/history.ts"
  );
  assert.ok(MEDIA_HISTORY_SCHEMA_VERSION >= 5, "the stored receipt grew, so the schema must have");

  const identityHash = "a".repeat(64);
  const stored = {
    schemaVersion: 4,
    entries: [
      {
        identityHash,
        // Exactly the shape schema 4 wrote: no codec, no source, no playback.
        quality: { label: "best-direct", width: 1280, height: 720, bitrate: 2_176_000, mime: "video/mp4" },
        at: "2026-05-19T12:00:00.000Z"
      }
    ],
    reservations: [],
    matches: { exact: 0, perceptual: 0, identity: 0 },
    lastMatch: null
  };

  const history = new MediaHistory(memoryStorage({ "aviary.media.history.v1": stored }));
  await history.load();
  const receipt = history.findQuality({ identityHash });

  assert.equal(receipt.label, "best-direct", "the old measurement survives");
  assert.equal(receipt.width, 1280);
  assert.equal(receipt.codec, null, "a record written before the field existed cannot claim a codec");
  assert.equal(receipt.codecSource, null);
  assert.equal(receipt.playbackProven, false, "and cannot claim playback either");
});

test("the optional helper produces a remux, and never offers it as the original", async () => {
  const { ADAPTIVE_HANDOFF_OUTPUT, YTDLP_FORMAT_POLICY, YTDLP_MERGE_POLICY, buildYtDlpCommand } =
    await importSourceModule("src/features/media/yt-dlp-helper.ts");

  // `bv*+ba/b` selects streams; `--merge-output-format` writes a container around them. Neither
  // re-encodes, which is why the declared quality cost is nothing at all.
  assert.equal(YTDLP_FORMAT_POLICY, "bv*+ba/b");
  assert.equal(YTDLP_MERGE_POLICY, "mp4/mkv");
  assert.equal(ADAPTIVE_HANDOFF_OUTPUT.losslessRemux, true);
  assert.equal(ADAPTIVE_HANDOFF_OUTPUT.transcoded, false);
  assert.equal(ADAPTIVE_HANDOFF_OUTPUT.qualityCost, null);
  assert.notEqual(ADAPTIVE_HANDOFF_OUTPUT.label, "original");

  const command = buildYtDlpCommand({
    manifestUrl: "https://video.twimg.com/amplify_video/1/pl/playlist.m3u8",
    filename: "fixture.%(ext)s",
    formatPolicy: YTDLP_FORMAT_POLICY
  });
  for (const reencode of ["--recode-video", "--postprocessor-args", "--remux-video"]) {
    assert.ok(!command.includes(reencode), `the command must not ask for ${reencode}`);
  }

  // And the label the receipt carries says what the file is, so history cannot read it as the
  // rendition X served.
  const { normalizeDownloadQuality } = await importSourceModule("src/extension/download-state.ts");
  const receipt = normalizeDownloadQuality({ label: ADAPTIVE_HANDOFF_OUTPUT.label, mime: "video/mp4" });
  assert.equal(receipt.label, "adaptive-remux");
  assert.notEqual(receipt.label, "original");
});

function fakeContainer({ currentSrc = "", readyState = 0, sources = [] } = {}) {
  const video = {
    currentSrc,
    src: "",
    poster: "",
    loop: false,
    muted: false,
    readyState,
    dataset: {},
    getAttribute: () => null,
    querySelectorAll: (selector) =>
      selector === "source"
        ? sources.map((entry) => ({
            src: entry.src,
            type: entry.type,
            dataset: entry.dataset ?? {},
            hasAttribute: (name) => name in (entry.dataset ?? {})
          }))
        : []
  };
  return {
    getAttribute: () => null,
    querySelector: (selector) => (selector === "video" ? video : null),
    querySelectorAll: () => []
  };
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, structuredClone(value)]));
  return {
    async get(key, fallback) {
      return values.has(key) ? structuredClone(values.get(key)) : fallback;
    },
    async set(key, value) {
      values.set(key, structuredClone(value));
    },
    async remove(key) {
      values.delete(key);
    }
  };
}
