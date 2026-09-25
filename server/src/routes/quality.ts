import { Router } from "express";
import { checkWebsiteQualityBatch } from "../services/websiteQuality";

export const qualityRouter = Router();

interface QualityCheckBody {
  items?: { placeId?: unknown; websiteUri?: unknown }[];
}

// POST so we can send an array of {placeId, websiteUri} pairs — GET query
// strings get unwieldy past a handful of results. Called by the frontend
// right after a search returns, so results can render first and quality
// bars fill in a moment later.
qualityRouter.post("/quality-check", async (req, res) => {
  const body = req.body as QualityCheckBody;
  const rawItems = Array.isArray(body.items) ? body.items : [];

  const items = rawItems
    .filter(
      (item): item is { placeId: string; websiteUri: string } =>
        typeof item.placeId === "string" && typeof item.websiteUri === "string" && item.websiteUri.length > 0
    )
    .slice(0, 20);

  if (items.length === 0) {
    return res.json({ results: [] });
  }

  try {
    const results = await checkWebsiteQualityBatch(items);
    return res.json({ results });
  } catch (err) {
    console.error("Unexpected error while checking website quality:", err);
    return res.status(500).json({ error: "Couldn't check website quality right now." });
  }
});
