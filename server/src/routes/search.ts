import type { SearchCircle } from "../types";

const { Router } = require("express");
const { GooglePlacesError, MAX_RADIUS_METERS, searchPlaces } = require("../services/googlePlaces");

export const searchRouter = Router();

function parseCircle(req: any): SearchCircle | null {
  const { lat, lng, radiusMeters } = req.query;
  if (typeof lat !== "string" || typeof lng !== "string" || typeof radiusMeters !== "string") {
    return null;
  }
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  const parsedRadius = Number(radiusMeters);
  if (
    !Number.isFinite(parsedLat) ||
    !Number.isFinite(parsedLng) ||
    !Number.isFinite(parsedRadius) ||
    parsedRadius <= 0
  ) {
    return null;
  }
  return {
    lat: parsedLat,
    lng: parsedLng,
    radiusMeters: Math.min(parsedRadius, MAX_RADIUS_METERS),
  };
}

searchRouter.get("/search", async (req: any, res: any) => {
  const location = typeof req.query.location === "string" ? req.query.location.trim() : "";
  const businessType =
    typeof req.query.businessType === "string" ? req.query.businessType.trim() : "";
  const circle = parseCircle(req);

  if (!location) {
    return res.status(400).json({ error: "A location is required to search for leads." });
  }

  try {
    const results = await searchPlaces(location, businessType || undefined, circle ?? undefined);
    return res.json({
      query: { location, businessType: businessType || null, circle },
      count: results.length,
      results,
    });
  } catch (err) {
    if (err instanceof GooglePlacesError) {
      const placesError = err as { status: number; message: string };
      return res.status(placesError.status).json({ error: placesError.message });
    }
    console.error("Unexpected error while searching Google Places:", err);
    return res.status(500).json({ error: "Something went wrong on the server." });
  }
});

module.exports = { searchRouter };