const cheerio = require("cheerio");

// Keep the extracted text well inside the target model's context window and
// cheap to send — a business homepage rarely needs more than this to be
// summarized accurately.
const MAX_CHARS = 6000;

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// Fetches a business's website and pulls out the visible, readable text —
// title plus body copy, stripped of scripts/styles/nav chrome — so it can
// be handed to the AI as plain language instead of raw HTML.
async function fetchSiteText(url: string): Promise<string> {
  if (!isValidHttpUrl(url)) {
    const err: any = new Error("Enter a full URL, like https://example.com.");
    err.status = 400;
    throw err;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; LEADBot/1.0; +https://github.com/) LEAD-pitch-generator",
      },
      redirect: "follow",
    });
  } catch (networkError) {
    const err: any = new Error("Could not reach that website. Check the URL and try again.");
    err.status = 502;
    throw err;
  }

  if (!response.ok) {
    const err: any = new Error(`That website returned HTTP ${response.status}.`);
    err.status = 422;
    throw err;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    const err: any = new Error("That URL doesn't look like a webpage LEAD can read.");
    err.status = 422;
    throw err;
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer, iframe").remove();

  const title = $("title").first().text().trim();
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();

  const combined = [title, bodyText].filter(Boolean).join("\n\n");
  if (!combined) {
    const err: any = new Error("LEAD couldn't find any readable text on that page.");
    err.status = 422;
    throw err;
  }

  return combined.slice(0, MAX_CHARS);
}

module.exports = { fetchSiteText, isValidHttpUrl };
