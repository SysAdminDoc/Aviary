import type { IntegrationSettings } from "../../platform/settings";

export type CrosspostTarget = "bluesky" | "mastodon";

export interface CrosspostRequest {
  text: string;
  target: CrosspostTarget;
  asThread?: boolean;
}

export interface CrosspostResult {
  ok: boolean;
  target: CrosspostTarget;
  url?: string;
  error?: string;
  posts?: number;
}

export function splitForThread(text: string): string[] {
  // Aviary keeps thread segmentation deterministic: split on blank lines, then chunk to platform max.
  const blocks = text
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  return blocks.length === 0 ? [text.trim()].filter((block) => block.length > 0) : blocks;
}

export async function crosspost(
  integrations: IntegrationSettings,
  request: CrosspostRequest
): Promise<CrosspostResult> {
  if (request.text.trim().length === 0) {
    return { ok: false, target: request.target, error: "Empty post body" };
  }
  const segments = request.asThread ? splitForThread(request.text) : [request.text];
  if (segments.length === 0) {
    return { ok: false, target: request.target, error: "Empty post body" };
  }
  if (request.target === "bluesky") {
    return postToBluesky(integrations.bluesky, segments);
  }
  return postToMastodon(integrations.mastodon, segments);
}

async function postToBluesky(
  config: IntegrationSettings["bluesky"],
  segments: readonly string[]
): Promise<CrosspostResult> {
  if (!config.enabled) return { ok: false, target: "bluesky", error: "Bluesky integration disabled" };
  if (!config.service || !config.handle || !config.appPassword) {
    return { ok: false, target: "bluesky", error: "Bluesky credentials missing" };
  }
  try {
    const session = await callBluesky(config.service, "com.atproto.server.createSession", {
      identifier: config.handle,
      password: config.appPassword
    });
    if (!session || typeof session.accessJwt !== "string" || typeof session.did !== "string") {
      return { ok: false, target: "bluesky", error: "Bluesky session response was malformed" };
    }
    let rootRef: { uri: string; cid: string } | null = null;
    let parentRef: { uri: string; cid: string } | null = null;
    let firstUri: string | null = null;
    for (const segment of segments) {
      const record: Record<string, unknown> = {
        text: segment.slice(0, 300),
        createdAt: new Date().toISOString(),
        $type: "app.bsky.feed.post"
      };
      if (rootRef && parentRef) {
        record.reply = {
          root: rootRef,
          parent: parentRef
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
        return { ok: false, target: "bluesky", error: "Bluesky post response was malformed" };
      }
      if (!rootRef) {
        rootRef = { uri, cid };
        firstUri = uri;
      }
      parentRef = { uri, cid };
    }
    const result: CrosspostResult = {
      ok: true,
      target: "bluesky",
      posts: segments.length
    };
    if (firstUri) result.url = deriveBlueskyUrl(firstUri, config.handle);
    return result;
  } catch (error) {
    return { ok: false, target: "bluesky", error: String((error as Error)?.message ?? error) };
  }
}

async function postToMastodon(
  config: IntegrationSettings["mastodon"],
  segments: readonly string[]
): Promise<CrosspostResult> {
  if (!config.enabled) return { ok: false, target: "mastodon", error: "Mastodon integration disabled" };
  if (!config.instance || !config.token) {
    return { ok: false, target: "mastodon", error: "Mastodon credentials missing" };
  }
  try {
    let inReplyTo: string | null = null;
    let firstUrl: string | null = null;
    for (const segment of segments) {
      const body: Record<string, unknown> = {
        status: segment,
        visibility: config.visibility
      };
      if (inReplyTo) body.in_reply_to_id = inReplyTo;
      const response = await fetch(`${config.instance}/api/v1/statuses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.token}`
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        return { ok: false, target: "mastodon", error: `Mastodon HTTP ${response.status}` };
      }
      const payload = (await response.json()) as { id?: string; url?: string };
      if (typeof payload?.id !== "string") {
        return { ok: false, target: "mastodon", error: "Mastodon response missing status id" };
      }
      inReplyTo = payload.id;
      if (typeof payload?.url === "string" && firstUrl === null) {
        firstUrl = payload.url;
      }
    }
    const result: CrosspostResult = { ok: true, target: "mastodon", posts: segments.length };
    if (firstUrl) result.url = firstUrl;
    return result;
  } catch (error) {
    return { ok: false, target: "mastodon", error: String((error as Error)?.message ?? error) };
  }
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
  const composer = document.querySelector('[data-testid="tweetTextarea_0"]');
  return composer?.textContent?.trim() ?? "";
}
