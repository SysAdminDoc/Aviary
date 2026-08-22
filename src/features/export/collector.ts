import { extractTweet, quotedPost, type ExtractTweetOptions } from "../media/extract.ts";
import { isSaveableVariantUrl } from "../media/video-extract.ts";
import { tweetIdFromHref } from "../media/urls.ts";
import type {
  ExportArticleSummary,
  ExportMedia,
  ExportPoll,
  ExportProfileAbout,
  ExportQuoteSummary,
  ExportRecord
} from "./types.ts";

export interface CollectExportOptions {
  mediaMetadata?: ExtractTweetOptions["mediaMetadata"];
}

export function collectExportRecords(
  root: ParentNode,
  surface: string,
  options: CollectExportOptions = {}
): ExportRecord[] {
  const articles = root instanceof Element && root.matches('article[data-testid="tweet"]')
    ? [root]
    : Array.from(root.querySelectorAll<Element>('article[data-testid="tweet"]'));

  const seen = new Set<string>();
  const records: ExportRecord[] = [];
  const now = new Date().toISOString();

  for (const article of articles) {
    const tweet = extractTweet(
      article,
      options.mediaMetadata ? { mediaMetadata: options.mediaMetadata } : {}
    );
    const key = `${tweet.tweetId ?? "noid"}:${tweet.handle ?? "noh"}:${(tweet.text || "").slice(0, 60)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const media: ExportMedia[] = [];
    for (const item of tweet.media) {
      if (item.kind === "video" && item.video?.preferred) {
        // A MediaSource blob URL is meaningless outside the tab that created it, so shipping it
        // in an export is worse than shipping nothing: the metadata and permalink still carry
        // what the record is, and the URL no longer pretends to be fetchable.
        const url = item.video.preferred.url;
        const entry: ExportMedia = {
          kind: "video",
          url: isSaveableVariantUrl(url) ? url : "",
          type: item.video.preferred.type
        };
        if (item.video.preferred.width !== null) entry.width = item.video.preferred.width;
        if (item.video.preferred.height !== null) entry.height = item.video.preferred.height;
        if (item.video.preferred.bitrate !== null) entry.bitrate = item.video.preferred.bitrate;
        media.push(entry);
      } else if (item.kind === "audio" && item.audio?.preferred) {
        const variant = item.audio.preferred;
        if (!isSaveableVariantUrl(variant.url, variant.type)) continue;
        media.push({
          kind: "audio",
          url: variant.url,
          type: variant.type,
          ...(variant.bitrate !== null ? { bitrate: variant.bitrate } : {})
        });
      } else if (item.kind === "subtitle" && item.subtitle?.track) {
        const track = item.subtitle.track;
        if (!isSaveableVariantUrl(track.url, track.type)) continue;
        media.push({
          kind: "subtitle",
          url: track.url,
          type: track.type,
          ...(track.language ? { language: track.language } : {}),
          ...(track.label ? { label: track.label } : {})
        });
      } else if (item.image) {
        const entry: ExportMedia = {
          kind: item.kind === "thumbnail" ? "thumbnail" : "photo",
          url: item.image.url,
          type: item.image.format
        };
        if (item.source instanceof HTMLImageElement && item.source.alt) {
          entry.altText = item.source.alt;
        }
        media.push(entry);
      } else {
        continue;
      }
      // A record that lists a quoted post's photo among its own media claims the account authored
      // it. Say whose it is instead of dropping it: the asset was on the page, and a reader of the
      // export can tell the two apart.
      const attributed = media.at(-1);
      if (attributed && item.owner.scope !== "post") {
        attributed.attribution = { scope: item.owner.scope, handle: item.owner.handle };
      }
    }

    const displayName = readDisplayName(article);
    const permalink = readPermalink(article, tweet.handle, tweet.tweetId);
    const poll = readPoll(article);
    const quote = readQuote(article);
    const articleSummary = readArticle(article);
    const birdwatch = readBirdwatch(article);

    const record: ExportRecord = {
      tweetId: tweet.tweetId,
      handle: tweet.handle,
      displayName,
      text: tweet.text,
      capturedAt: now,
      surface,
      media,
      permalink
    };
    if (poll) record.poll = poll;
    if (quote) record.quote = quote;
    if (articleSummary) record.article = articleSummary;
    if (birdwatch) record.birdwatch = birdwatch;
    records.push(record);
  }

  return records;
}

export function collectProfileAbout(root: ParentNode): ExportProfileAbout | null {
  const main = root.querySelector('[data-testid="primaryColumn"]');
  if (!main) return null;
  const handleNode = main.querySelector('[data-testid="UserName"] span');
  const handleText = handleNode?.textContent?.trim() ?? "";
  const handle = handleText.replace(/^@/, "");
  if (!handle) return null;

  const displayName = readFirstText(main.querySelector('[data-testid="UserName"]'));
  const bio = readFirstText(main.querySelector('[data-testid="UserDescription"]'));
  const location = readFirstText(main.querySelector('[data-testid="UserLocation"]'));
  const urlLink = main.querySelector<HTMLAnchorElement>('[data-testid="UserUrl"]');
  const joined = readFirstText(main.querySelector('[data-testid="UserJoinDate"]'));
  const followingCount = readFirstText(main.querySelector('a[href$="/following"]'));
  const followerCount = readFirstText(main.querySelector('a[href$="/verified_followers"], a[href$="/followers"]'));

  return {
    handle,
    displayName,
    bio,
    location,
    url: urlLink?.href ?? urlLink?.getAttribute("href") ?? null,
    joined,
    followingCount,
    followerCount
  };
}

function readPoll(article: Element): ExportPoll | null {
  const bars = Array.from(article.querySelectorAll('[data-testid$="-progress-bar"], [data-testid="cardPoll"] li'));
  if (bars.length === 0) {
    return null;
  }
  const choices: ExportPoll["choices"] = [];
  for (const bar of bars) {
    const label = readFirstText(bar);
    if (!label) continue;
    const percentMatch = /([0-9]+(?:\.[0-9]+)?)\s*%/.exec(bar.textContent ?? "");
    const choice: ExportPoll["choices"][number] = { label };
    if (percentMatch) {
      choice.percent = Number(percentMatch[1]);
      choice.voteShare = `${percentMatch[1]}%`;
    }
    choices.push(choice);
  }
  if (choices.length === 0) {
    return null;
  }
  const totals = article.querySelector('[data-testid="cardPoll"] span');
  const totalText = totals?.textContent?.trim() ?? "";
  const poll: ExportPoll = { choices };
  if (totalText.length > 0) {
    poll.totalVotes = totalText;
  }
  return poll;
}

function readQuote(article: Element): ExportQuoteSummary | null {
  // One definition of "this is a quoted post", shared with the media extractor. They used to
  // disagree: this looked only for the two named test ids, while X's current Home renders the
  // quote as a focusable div with no test id at all -- so a record could carry the quoted post's
  // photo with no note that a quote existed.
  const quote = quotedPost(article);
  if (!quote) {
    return null;
  }
  const handleLink = quote.querySelector<HTMLAnchorElement>('a[href^="/"]');
  const handle = handleLink ? /\/([A-Za-z0-9_]{1,15})/.exec(handleLink.getAttribute("href") ?? "")?.[1] ?? null : null;
  const text = quote.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? "";
  return { handle, text };
}

function readArticle(article: Element): ExportArticleSummary | null {
  const card = article.querySelector('[data-testid="card.wrapper"], [data-testid="article"]');
  if (!card) {
    return null;
  }
  const titleNode = card.querySelector('[data-testid="card.layoutLarge.detail"] span, [data-testid="article-title"], h2');
  const link = card.querySelector<HTMLAnchorElement>('a[href]');
  return {
    title: titleNode?.textContent?.trim() ?? null,
    url: link?.href ?? link?.getAttribute("href") ?? null
  };
}

function readBirdwatch(article: Element): string | undefined {
  const pivot = article.querySelector('[data-testid="birdwatch-pivot"]');
  if (!pivot) return undefined;
  return pivot.textContent?.trim() || undefined;
}

function readFirstText(node: Element | null | undefined): string | null {
  if (!node) return null;
  const text = node.textContent?.trim() ?? "";
  return text.length > 0 ? text : null;
}

function readDisplayName(article: Element): string | null {
  const userName = article.querySelector('[data-testid="User-Name"]');
  if (!userName) {
    return null;
  }
  const spans = Array.from(userName.querySelectorAll("span"));
  for (const span of spans) {
    const text = span.textContent?.trim() ?? "";
    if (text.length > 0 && !text.startsWith("@") && !text.startsWith("·")) {
      return text;
    }
  }
  return null;
}

function readPermalink(article: Element, handle: string | null, tweetId: string | null): string | null {
  if (handle && tweetId) {
    return `https://x.com/${handle}/status/${tweetId}`;
  }
  const link = article.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
  const href = link?.getAttribute("href") ?? null;
  if (href && tweetIdFromHref(href)) {
    return new URL(href, "https://x.com").toString();
  }
  return null;
}
