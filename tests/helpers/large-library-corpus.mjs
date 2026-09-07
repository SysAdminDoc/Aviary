export const LARGE_LIBRARY_RECORD_COUNT = 50_000;
export const LARGE_LIBRARY_HEAP_BUDGET_BYTES = 128 * 1024 * 1024;

const MEDIA_KINDS = new Set(["photo", "video", "thumbnail", "audio", "subtitle"]);

/**
 * A deterministic mixed corpus used by the release matrix. It deliberately keeps media payloads
 * tiny because this lane measures record and index behavior, not a network transfer.
 */
export function createLargeLibraryCorpus(count = LARGE_LIBRARY_RECORD_COUNT) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    if (index % 997 === 0) {
      rows.push({ tombstone: true, id: `post-${Math.max(0, index - 1)}` });
      continue;
    }
    if (index % 991 === 0) {
      rows.push({ tweetId: `broken-${index}`, text: 42, media: "not-an-array" });
      continue;
    }

    const duplicateId = index % 211 === 0 ? `post-${index - 1}` : `post-${index}`;
    const media = [];
    if (index % 29 === 0) {
      media.push({
        kind: "photo",
        url: `https://pbs.twimg.com/media/fixture-${index}.jpg`,
        type: "image/jpeg",
        captureStatus: "remote-reference"
      });
    }
    if (index % 37 === 0) {
      media.push({
        kind: "video",
        url: `https://video.twimg.com/ext_tw_video/fixture-${index}.mp4`,
        type: "video/mp4",
        bitrate: 1_000_000 + index,
        bytes: new Uint8Array([index & 0xff, (index >>> 8) & 0xff])
      });
    }
    if (index % 43 === 0) {
      media.push({
        kind: "photo",
        url: "",
        captureStatus: "missing",
        captureError: "bytes not retained"
      });
    }
    rows.push({
      tweetId: duplicateId,
      handle: `fixture_user_${index % 200}`,
      displayName: `Fixture user ${index % 200}`,
      text: `Deterministic library post ${index}. needle-${index % 17}`,
      capturedAt: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      createdAt: `2025-12-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      surface: "home",
      media,
      permalink: `https://x.com/fixture_user_${index % 200}/status/${duplicateId}`
    });
  }
  return rows;
}

export function normalizeLargeLibraryRows(rows) {
  const records = [];
  const partials = [];
  const seenIds = new Set();
  for (const [index, row] of rows.entries()) {
    if (isTombstone(row)) {
      partials.push({ index, reason: "tombstone" });
      continue;
    }
    if (!isRecord(row) || typeof row.tweetId !== "string" || typeof row.text !== "string" || !Array.isArray(row.media)) {
      partials.push({ index, reason: "malformed" });
      continue;
    }
    if (seenIds.has(row.tweetId)) {
      partials.push({ index, reason: "duplicate-id" });
      continue;
    }
    const media = row.media.filter(isMedia).map((entry) => ({ ...entry }));
    records.push({
      ...row,
      media,
      handle: typeof row.handle === "string" ? row.handle : null,
      displayName: typeof row.displayName === "string" ? row.displayName : null,
      permalink: typeof row.permalink === "string" ? row.permalink : null
    });
    seenIds.add(row.tweetId);
  }
  return { records, partials };
}

export function corpusStats(rows, normalized) {
  return {
    rows: rows.length,
    records: normalized.records.length,
    tombstones: normalized.partials.filter((entry) => entry.reason === "tombstone").length,
    malformed: normalized.partials.filter((entry) => entry.reason === "malformed").length,
    duplicates: normalized.partials.filter((entry) => entry.reason === "duplicate-id").length,
    missingBytes: normalized.records.reduce(
      (total, record) => total + record.media.filter((media) => !(media.bytes instanceof Uint8Array)).length,
      0
    )
  };
}

function isTombstone(value) {
  return isRecord(value) && value.tombstone === true;
}

function isMedia(value) {
  return isRecord(value) && MEDIA_KINDS.has(value.kind) && typeof value.url === "string";
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
