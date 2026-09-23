import type {
  ApiErrorBody,
  SearchCircle,
  SearchResponse,
  TrackedLead,
  WebsiteQualityResult,
} from "./types";

async function parseOrThrow<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    const errorBody = body as ApiErrorBody;
    throw new Error(errorBody.error || "Something went wrong.");
  }
  return body as T;
}

export async function searchLeads(
  location: string,
  businessType: string,
  circle: SearchCircle | null
): Promise<SearchResponse> {
  const params = new URLSearchParams({ location });
  if (businessType.trim()) {
    params.set("businessType", businessType.trim());
  }
  if (circle) {
    params.set("lat", String(circle.lat));
    params.set("lng", String(circle.lng));
    params.set("radiusMeters", String(Math.round(circle.radiusMeters)));
  }

  const response = await fetch(`/api/search?${params.toString()}`);
  return parseOrThrow<SearchResponse>(response);
}

export async function checkWebsiteQuality(
  businesses: TrackedLead[]
): Promise<WebsiteQualityResult[]> {
  const items = businesses
    .filter((b) => b.hasWebsite && b.websiteUri)
    .map((b) => ({ placeId: b.id, websiteUri: b.websiteUri as string }));

  if (items.length === 0) return [];

  const response = await fetch("/api/quality-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  const body = await parseOrThrow<{ results: WebsiteQualityResult[] }>(response);
  return body.results;
}
