import * as cheerio from "cheerio";
import type { WebsiteQualityResult, WebsiteQualityStatus } from "../types.js";

const FETCH_TIMEOUT_MS = 5000;

// Hosts where Google will happily list "websiteUri" but it isn't really a
// dedicated business website — just a social profile or link-in-bio page.
// These count as a real signal (the business hasn't built a proper site)
// even though, strictly speaking, a URL is present.
const SOCIAL_ONLY_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linktr.ee",
  "linktree.com",
  "m.me",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "yelp.com",
  "tiktok.com",
];

const PARKED_OR_PLACEHOLDER_PATTERNS = [
  /this domain (is|may be) for sale/i,
  /domain (has been )?parked/i,
  /coming soon/i,
  /under construction/i,
  /website (is )?currently unavailable/i,
  /future home of something/i,
  /buy this domain/i,
];

function classify(score: number): WebsiteQualityStatus {
  if (score >= 70) return "good";
  if (score >= 40) return "okay";
  return "bad";
}

function isSocialOnlyHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  return SOCIAL_ONLY_HOSTS.some((social) => host === social || host.endsWith(`.${social}`));
}

export async function checkWebsiteQuality(
  placeId: string,
  websiteUri: string
): Promise<WebsiteQualityResult> {
  let url: URL;
  try {
    url = new URL(websiteUri);
  } catch {
    return { placeId, status: "unreachable", score: 0, reasons: ["Website URL is malformed."] };
  }

  if (isSocialOnlyHost(url.hostname)) {
    return {
      placeId,
      status: "bad",
      score: 20,
      reasons: [`Links to ${url.hostname.replace(/^www\./, "")} instead of a dedicated site.`],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  let finalUrl: URL;
  try {
    const response = await fetch(url.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LEADWebsiteCheck/1.0; +https://example.com/lead)",
      },
    });
    finalUrl = new URL(response.url || url.toString());

    if (!response.ok) {
      return {
        placeId,
        status: "unreachable",
        score: 0,
        reasons: [`Site responded with an error (HTTP ${response.status}).`],
      };
    }
    html = await response.text();
  } catch {
    return {
      placeId,
      status: "unreachable",
      score: 0,
      reasons: ["Site didn't respond within a few seconds."],
    };
  } finally {
    clearTimeout(timeout);
  }

  // A redirect can land on a social/link-in-bio host even if the original
  // URL didn't look like one.
  if (isSocialOnlyHost(finalUrl.hostname)) {
    return {
      placeId,
      status: "bad",
      score: 20,
      reasons: [`Redirects to ${finalUrl.hostname.replace(/^www\./, "")}.`],
    };
  }

  const reasons: string[] = [];
  let score = 100;

  const $ = cheerio.load(html);
  const title = $("title").first().text().trim();
  const visibleText = $("body").text().replace(/\s+/g, " ").trim();

  if (PARKED_OR_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(html))) {
    score -= 45;
    reasons.push("Page looks parked or still under construction.");
  }

  if (!title || /^(untitled|home|index of)/i.test(title)) {
    score -= 15;
    reasons.push("Missing or generic page title.");
  }

  if (!$('meta[name="viewport"]').length) {
    score -= 10;
    reasons.push("No mobile viewport tag — likely not mobile-friendly.");
  }

  if (url.protocol !== "https:" && finalUrl.protocol !== "https:") {
    score -= 10;
    reasons.push("Not served over HTTPS.");
  }

  if (visibleText.length < 200) {
    score -= 15;
    reasons.push("Very little visible content on the page.");
  }

  score = Math.max(0, Math.min(100, score));

  if (reasons.length === 0) {
    reasons.push("No obvious issues found.");
  }

  return { placeId, status: classify(score), score, reasons };
}

// Runs quality checks for several businesses at once, bounded so a large
// result set doesn't fire dozens of simultaneous outbound requests.
export async function checkWebsiteQualityBatch(
  items: { placeId: string; websiteUri: string }[],
  concurrency = 5
): Promise<WebsiteQualityResult[]> {
  const results: WebsiteQualityResult[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      results.push(await checkWebsiteQuality(current.placeId, current.websiteUri));
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
