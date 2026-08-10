export interface ExportRecord {
  tweetId: string | null;
  handle: string | null;
  displayName: string | null;
  text: string;
  capturedAt: string;
  surface: string;
  media: ExportMedia[];
  permalink: string | null;
  poll?: ExportPoll;
  quote?: ExportQuoteSummary;
  article?: ExportArticleSummary;
  birdwatch?: string;
}

export interface ExportMedia {
  kind: "photo" | "video" | "thumbnail";
  url: string;
  width?: number;
  height?: number;
  bitrate?: number;
  type?: string;
  altText?: string;
}

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

export interface ExportProfileAbout {
  handle: string;
  displayName: string | null;
  bio: string | null;
  location: string | null;
  url: string | null;
  joined: string | null;
  followingCount: string | null;
  followerCount: string | null;
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
