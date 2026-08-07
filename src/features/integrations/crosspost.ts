import type { IntegrationSettings } from "../../platform/settings";
import { assertOutboundAllowed } from "./network-policy";

export type CrosspostTarget = "bluesky" | "mastodon";

export interface CrosspostRequest {
  text: string;
  target: CrosspostTarget;
  asThread?: boolean;
  attachment?: CrosspostAttachment;
}

export interface CrosspostAttachment {
  url: string;
  filename: string;
  kind?: "photo" | "video" | "thumbnail";
}

export interface CrosspostResult {
  ok: boolean;
  target: CrosspostTarget;
  url?: string;
  error?: string;
  posts?: number;
}

/** Post length limits, counted in graphemes because that is what both platforms count. */
export const TARGET_LIMITS: Record<CrosspostTarget, number> = {
  bluesky: 300,
  mastodon: 500
};

export function splitForThread(text: string): string[] {
  const blocks = text
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  return blocks.length === 0 ? [text.trim()].filter((block) => block.length > 0) : blocks;
}

/** Grapheme count, so an emoji or a family sequence costs what the platform charges for it. */
function graphemes(text: string): string[] {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (typeof Segmenter === "function") {
    return Array.from(
      new Segmenter(undefined, { granularity: "grapheme" }).segment(text),
      (part) => part.segment
    );
  }
  return Array.from(text);
}

/**
 * Splits a block that is over the limit, preferring a word boundary.
 *
 * The old code sliced Bluesky segments to 300 UTF-16 units and posted the rest nowhere -- silent
 * content loss -- while Mastodon got no chunking at all and simply returned HTTP 422. The comment
 * on splitForThread had promised this since the feature shipped.
 */
export function chunkToLimit(text: string, limit: number): string[] {
  const units = graphemes(text);
  if (units.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let index = 0;
  while (index < units.length) {
    let take = Math.min(limit, units.length - index);
    if (index + take < units.length) {
      // Back up to the last space in this window so words are not cut in half. If there is none
      // (a long URL, or a script written without spaces), take the whole window.
      const window = units.slice(index, index + take);
      const lastSpace = window.lastIndexOf(" ");
      if (lastSpace > limit * 0.5) {
        take = lastSpace;
      }
    }
    chunks.push(units.slice(index, index + take).join("").trim());
    index += take;
  }
  return chunks.filter((chunk) => chunk.length > 0);
}

export function segmentsForTarget(
  text: string,
  target: CrosspostTarget,
  asThread: boolean
): string[] {
  const blocks = asThread ? splitForThread(text) : [text];
  return blocks.flatMap((block) => chunkToLimit(block, TARGET_LIMITS[target]));
}

export async function crosspost(
  integrations: IntegrationSettings,
  request: CrosspostRequest
): Promise<CrosspostResult> {
  assertOutboundAllowed("The crosspost");
  if (request.text.trim().length === 0) {
    return { ok: false, target: request.target, error: "Empty post body" };
  }
  const segments = segmentsForTarget(request.text, request.target, request.asThread === true);
  if (segments.length === 0) {
    return { ok: false, target: request.target, error: "Empty post body" };
  }
  if (request.target === "bluesky") {
    return postToBluesky(integrations.bluesky, segments, request.attachment);
  }
  return postToMastodon(integrations.mastodon, segments, request.attachment);
}

async function postToBluesky(
  config: IntegrationSettings["bluesky"],
  segments: readonly string[],
  attachment?: CrosspostAttachment
): Promise<CrosspostResult> {
  if (!config.enabled) return { ok: false, target: "bluesky", error: "Bluesky integration disabled" };
  if (!config.service || !config.handle || !config.appPassword) {
    return { ok: false, target: "bluesky", error: "Bluesky credentials missing" };
  }
  // Declared outside the try: a throw mid-thread has still published everything before it, and
  // the catch has to be able to say so.
  let firstUri: string | null = null;
  let posted = 0;
  try {
    const session = await callBluesky(config.service, "com.atproto.server.createSession", {
      identifier: config.handle,
      password: config.appPassword
    });
    if (!session || typeof session.accessJwt !== "string" || typeof session.did !== "string") {
      return { ok: false, target: "bluesky", error: "Bluesky session response was malformed" };
    }
    const uploadedBlob = attachment
      ? await uploadBlueskyImage(config.service, session.accessJwt, attachment)
      : null;
    let rootRef: { uri: string; cid: string } | null = null;
    let parentRef: { uri: string; cid: string } | null = null;
    for (const segment of segments) {
      const record: Record<string, unknown> = {
        text: segment,
        createdAt: new Date().toISOString(),
        $type: "app.bsky.feed.post"
      };
      if (rootRef && parentRef) {
        record.reply = {
          root: rootRef,
          parent: parentRef
        };
      }
      if (uploadedBlob && !rootRef) {
        record.embed = {
          $type: "app.bsky.embed.images",
          images: [{ alt: "", image: uploadedBlob }]
        };
      }
      const response = await callBluesky(
        config.service,
        "com.atproto.repo.createRecord",
        {
          repo: session.did,
          collection: "app.bsky.feed.post",
          record
        },
        session.accessJwt
      );
      const uri = typeof response?.uri === "string" ? response.uri : null;
      const cid = typeof response?.cid === "string" ? response.cid : null;
      if (!uri || !cid) {
        return partialFailure("bluesky", "Bluesky post response was malformed", posted, firstUri ? deriveBlueskyUrl(firstUri, config.handle) : null);
      }
      if (!rootRef) {
        rootRef = { uri, cid };
        firstUri = uri;
      }
      parentRef = { uri, cid };
      posted += 1;
    }
    const result: CrosspostResult = {
      ok: true,
      target: "bluesky",
      posts: segments.length
    };
    if (firstUri) result.url = deriveBlueskyUrl(firstUri, config.handle);
    return result;
  } catch (error) {
    return partialFailure(
      "bluesky",
      String((error as Error)?.message ?? error),
      posted,
      firstUri ? deriveBlueskyUrl(firstUri, config.handle) : null
    );
  }
}

/**
 * A thread that stopped halfway has already published posts. Saying only "failed" invites a
 * retry that double-posts, so the count and the first URL come back with the error.
 */
function partialFailure(
  target: CrosspostTarget,
  error: string,
  posted: number,
  url: string | null
): CrosspostResult {
  const result: CrosspostResult = {
    ok: false,
    target,
    error: posted > 0 ? `${error} — ${posted} of the thread was already posted` : error
  };
  if (posted > 0) result.posts = posted;
  if (url) result.url = url;
  return result;
}

async function postToMastodon(
  config: IntegrationSettings["mastodon"],
  segments: readonly string[],
  attachment?: CrosspostAttachment
): Promise<CrosspostResult> {
  if (!config.enabled) return { ok: false, target: "mastodon", error: "Mastodon integration disabled" };
  if (!config.instance || !config.token) {
    return { ok: false, target: "mastodon", error: "Mastodon credentials missing" };
  }
  let firstUrl: string | null = null;
  let posted = 0;
  try {
    const mediaId = attachment ? await uploadMastodonMedia(config.instance, config.token, attachment) : null;
    let inReplyTo: string | null = null;
    for (const segment of segments) {
      const body: Record<string, unknown> = {
        status: segment,
        visibility: config.visibility
      };
      if (inReplyTo) body.in_reply_to_id = inReplyTo;
      if (mediaId && !inReplyTo) body.media_ids = [mediaId];
      const response = await fetch(`${config.instance}/api/v1/statuses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.token}`
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        return partialFailure("mastodon", `Mastodon HTTP ${response.status}`, posted, firstUrl);
      }
      const payload = (await response.json()) as { id?: string; url?: string };
      if (typeof payload?.id !== "string") {
        return partialFailure("mastodon", "Mastodon response missing status id", posted, firstUrl);
      }
      inReplyTo = payload.id;
      posted += 1;
      if (typeof payload?.url === "string" && firstUrl === null) {
        firstUrl = payload.url;
      }
    }
    const result: CrosspostResult = { ok: true, target: "mastodon", posts: segments.length };
    if (firstUrl) result.url = firstUrl;
    return result;
  } catch (error) {
    return partialFailure("mastodon", String((error as Error)?.message ?? error), posted, firstUrl);
  }
}

async function uploadBlueskyImage(
  service: string,
  accessJwt: string,
  attachment: CrosspostAttachment
): Promise<Record<string, unknown>> {
  const media = await fetchAttachment(attachment);
  if (!media.contentType.startsWith("image/")) {
    throw new Error("Bluesky crosspost attachments must be images");
  }
  const response = await fetch(`${service}/xrpc/com.atproto.repo.uploadBlob`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessJwt}`,
      "content-type": media.contentType
    },
    body: media.blob
  });
  if (!response.ok) {
    throw new Error(`Bluesky media upload HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { blob?: unknown };
  if (!isRecord(payload.blob)) {
    throw new Error("Bluesky media response was malformed");
  }
  return payload.blob;
}

async function uploadMastodonMedia(
  instance: string,
  token: string,
  attachment: CrosspostAttachment
): Promise<string> {
  const media = await fetchAttachment(attachment);
  const form = new FormData();
  form.append("file", media.blob, safeFilename(attachment.filename));
  const response = await fetch(`${instance}/api/v1/media`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form
  });
  if (!response.ok) {
    throw new Error(`Mastodon media upload HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { id?: unknown };
  if (typeof payload.id !== "string" || payload.id.length === 0) {
    throw new Error("Mastodon media response missing id");
  }
  return payload.id;
}

async function fetchAttachment(
  attachment: CrosspostAttachment
): Promise<{ blob: Blob; contentType: string }> {
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`Media attachment HTTP ${response.status}`);
  }
  const contentType = normalizeContentType(response.headers.get("content-type")) ?? inferContentType(attachment);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error("Media attachment was empty");
  }
  return { blob: new Blob([bytes], { type: contentType }), contentType };
}

function normalizeContentType(value: string | null): string | null {
  const type = value?.split(";", 1)[0]?.trim().toLowerCase();
  return type && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) ? type : null;
}

function inferContentType(attachment: CrosspostAttachment): string {
  const filename = attachment.filename.toLowerCase();
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".gif")) return "image/gif";
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".mp4")) return "video/mp4";
  if (filename.endsWith(".webm")) return "video/webm";
  return "image/jpeg";
}

function safeFilename(value: string): string {
  const cleaned = value.replace(/[\\/\u0000-\u001f]/g, "_").trim();
  return cleaned.slice(0, 160) || "aviary-media";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function callBluesky(
  service: string,
  nsid: string,
  input: Record<string, unknown>,
  bearer?: string
): Promise<Record<string, unknown> | null> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const response = await fetch(`${service}/xrpc/${nsid}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(`Bluesky ${nsid} HTTP ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

function deriveBlueskyUrl(uri: string, handle: string): string {
  const match = /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/(.+)$/.exec(uri);
  const rkey = match?.[1];
  return rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : `https://bsky.app/profile/${handle}`;
}

export function readComposerText(): string {
  const composer = document.querySelector<HTMLElement>('[data-testid="tweetTextarea_0"]');
  if (!composer) {
    return "";
  }
  // Draft.js renders one element per paragraph, and textContent concatenates them with no
  // separator -- so a two-paragraph draft arrived here as a single run and the blank-line split
  // that drives thread mode could never fire from the real composer.
  const blocks = Array.from(composer.querySelectorAll<HTMLElement>('[data-block="true"]'));
  if (blocks.length > 0) {
    return blocks
      .map((block) => block.textContent ?? "")
      .join("\n\n")
      .trim();
  }
  return (composer.innerText ?? composer.textContent ?? "").trim();
}
