import type { ExportAudience } from "./audience.ts";

export interface ExportRecord {
  /**
   * Which shape of X archive this record was imported from, when it was imported from one.
   *
   * X's export has changed by accretion, so two records of the same post can carry different
   * fields depending on which vintage produced them. Keeping the vintage on the record is what
   * lets a later import of a newer export supersede an older one by canonical post id instead of
   * merging two partial views into one wrong record. Absent on anything captured from a page.
   */
  archiveVintage?: "current" | "tweet-js" | "grailbird";

  tweetId: string | null;
  handle: string | null;
  displayName: string | null;
  text: string;
  capturedAt: string;
  surface: string;
  media: ExportMedia[];
  permalink: string | null;
  /** Canonical BCP 47 language supplied by X, or null when it was not supplied. */
  language?: string | null;
  /** Audience state observed at capture time. Missing legacy records normalize to `unknown`. */
  audience?: ExportAudience;
  poll?: ExportPoll;
  quote?: ExportQuoteSummary;
  article?: ExportArticleSummary;
  birdwatch?: string;
  /** X conversation root shared by the post and its replies. */
  conversationId?: string | null;
  /** The immediate post this record replies to, when X exposed it. */
  parentId?: string | null;
  /** Root status id retained separately so partial contexts can show a visible gap. */
  rootId?: string | null;
  /** Stable author identity used to distinguish a self-thread from a conversation. */
  authorId?: string | null;
  /** Original post creation time. `capturedAt` remains the local capture time. */
  createdAt?: string | null;
  /** Compatibility field used by older captures and imported records. */
  threadId?: string | null;
  /** Account references carried by imported records without changing the original post text. */
  participants?: ExportParticipant[];
  /** Short links expanded from metadata already present in an archive or local capture. */
  expandedUrls?: ExportExpandedUrl[];
}

export interface ExportParticipant {
  id: string;
  handle: string | null;
  label: string;
  role: "mention";
}

export interface ExportExpandedUrl {
  shortUrl: string;
  destination: string;
  source: "archive" | "local-corpus";
}

/** What a capture-size setting did to one asset, recorded on the asset. */
export interface MediaCaptureReduction {
  /** The fraction of the original pixel dimensions kept. Absent when the image was not rescaled. */
  imageScale?: number;
  /** True when a video's poster frame was stored in place of the video. */
  posterFrameOnly?: true;
  /** True when poster-frames-only was on but the video had no poster, so nothing was stored. */
  posterMissing?: true;
  /** What the host served for the asset that was stored, before it was rescaled. */
  originalByteLength?: number;
  /** Known size of the asset that was left out, when a poster replaced a video. */
  replacedByteLength?: number;
}

export interface ExportMedia {
  kind: "photo" | "video" | "thumbnail" | "audio" | "subtitle";
  url: string;
  /** Canonical source URL retained when `url` is blank because the capture was not usable. */
  sourceUrl?: string;
  /** Capture time for the asset; the record capture time is used when this is absent. */
  capturedAt?: string;
  /** Byte metadata learned by a downloader or a HEAD request. */
  byteLength?: number;
  sha256?: string;
  /** HTTP response status retained when the capture included the status line. */
  httpStatus?: number;
  /** Safe response headers retained for truthful WARC response records. */
  httpHeaders?: Record<string, string>;
  captureStatus?: MediaCaptureStatus;
  captureError?: string;
  /**
   * How this capture was reduced before it was stored, when it was.
   *
   * Absent means the bytes are what the host served. A record with a reduction is not the
   * original, and an export that presents it as one is wrong about its own contents -- which is
   * the whole reason a capture-size setting has to leave a trace on each record rather than only
   * in the settings that were live when it ran.
   */
  reduction?: MediaCaptureReduction;
  /**
   * Present when the asset was inside the post but is not the post's own: a quoted post's media,
   * or a link card's preview. Absent means the record's own account published it.
   */
  attribution?: { scope: "quote" | "card"; handle: string | null; audience?: ExportAudience };
  /** Transient bytes supplied to package/WARC builders; never serialized as a JSON object. */
  bytes?: Uint8Array;
  /** Relative path assigned by the package builder when `bytes` are present. */
  assetPath?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  type?: string;
  /**
   * The still X serves for a video, when it serves one.
   *
   * It is the only part of a video a capture can keep cheaply, and until now the export dropped
   * it, so a record with the video bytes left out had no picture at all.
   */
  poster?: string;
  altText?: string;
  language?: string;
  label?: string;
}

export type MediaCaptureStatus = "captured-bytes" | "remote-reference" | "missing";

export interface ExportPoll {
  choices: Array<{ label: string; percent?: number; voteShare?: string }>;
  totalVotes?: string;
  endsAt?: string;
}

export interface ExportQuoteSummary {
  handle: string | null;
  text: string;
}

export interface ExportArticleSummary {
  title: string | null;
  url: string | null;
}

export type ExportFormat = "json" | "csv" | "html" | "markdown" | "xlsx";

export interface ExportArtifact {
  filename: string;
  contentType: string;
  data: Uint8Array;
}

export type ExportJobStatus = "queued" | "running" | "paused" | "cancelled" | "failed" | "completed";

export interface ExportJobProgress {
  completed: number;
  total: number | null;
}

export interface ExportCheckpoint {
  jobId: string;
  startedAt: string;
  surface: string;
  recordCount: number;
  done: boolean;
  formats: ExportFormat[];
  preserveRawPayloads: boolean;
  status: ExportJobStatus;
  progress: ExportJobProgress;
  updatedAt: string;
  resumeOnBoot: boolean;
  error?: string;
}
