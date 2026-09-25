import type {
  GooglePlace,
  GooglePlacesErrorResponse,
  GooglePlacesSearchResponse,
  LeadResult,
  SearchCircle,
} from "../types";

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

// Only ask Google for the fields LEAD actually displays. This keeps each
// request on the cheaper end of the Places API (New) pricing tiers and
// avoids pulling data (hours, photos, editorial summaries, etc.) that the
// MVP never uses.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.primaryTypeDisplayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.websiteUri",
].join(",");

// Keep the MVP's search radius/size modest on purpose, per spec: no
// pagination, no state-wide sweeps. One page of results per search.
const PAGE_SIZE = 20;

// Google caps locationRestriction/locationBias circles at 50km.
export const MAX_RADIUS_METERS = 50000;

export class GooglePlacesError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "GooglePlacesError";
    this.status = status;
  }
}

// When the caller has already drawn a circle on the map, we search that
// circle directly (locationRestriction) and only need the business type in
// the text query. Mixing an explicit location string into the query text
// isn't necessary here and Google's docs note that an explicit location in
// textQuery can override locationBias anyway — locationRestriction avoids
// that ambiguity entirely.
function buildTextQuery(location: string, businessType?: string, circle?: SearchCircle): string {
  const trimmedType = businessType?.trim();
  if (circle) {
    return trimmedType || "businesses";
  }
  const trimmedLocation = location.trim();
  return trimmedType
    ? `${trimmedType} in ${trimmedLocation}`
    : `businesses in ${trimmedLocation}`;
}

function toLeadResult(place: GooglePlace, fallbackCategory: string): LeadResult {
  const websiteUri = place.websiteUri?.trim() || null;
  return {
    id: place.id,
    name: place.displayName?.text ?? "Unnamed business",
    category: place.primaryTypeDisplayName?.text ?? fallbackCategory,
    address: place.formattedAddress ?? "Address not listed",
    phone: place.nationalPhoneNumber ?? null,
    rating: typeof place.rating === "number" ? place.rating : null,
    reviewCount:
      typeof place.userRatingCount === "number" ? place.userRatingCount : null,
    googleMapsUri: place.googleMapsUri ?? null,
    websiteUri,
    hasWebsite: Boolean(websiteUri),
  };
}

export async function searchPlaces(
  location: string,
  businessType?: string,
  circle?: SearchCircle
): Promise<LeadResult[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new GooglePlacesError(
      "The server has no Google Maps API key configured. Add GOOGLE_MAPS_API_KEY to server/.env and restart the server.",
      500
    );
  }

  const textQuery = buildTextQuery(location, businessType, circle);
  const fallbackCategory = businessType?.trim() || "Business";

  const requestBody: Record<string, unknown> = {
    textQuery,
    pageSize: PAGE_SIZE,
  };

  if (circle) {
    // Text Search's locationRestriction only accepts a rectangular
    // viewport — a circle is only valid inside locationBias. Google's
    // docs warn that an explicit location *name* in textQuery can override
    // locationBias, but our circle-mode textQuery never includes one (see
    // buildTextQuery above), so that override risk doesn't apply here.
    requestBody.locationBias = {
      circle: {
        center: { latitude: circle.lat, longitude: circle.lng },
        radius: Math.min(circle.radiusMeters, MAX_RADIUS_METERS),
      },
    };
  }

  let response: Response;
  try {
    response = await fetch(PLACES_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (networkError) {
    throw new GooglePlacesError(
      "Could not reach the Google Places API. Check your internet connection and try again.",
      502
    );
  }

  if (!response.ok) {
    let message = `Google Places API request failed (HTTP ${response.status}).`;
    let googleStatus: string | undefined;
    try {
      const errorBody = (await response.json()) as GooglePlacesErrorResponse;
      if (errorBody.error?.message) {
        message = errorBody.error.message;
      }
      googleStatus = errorBody.error?.status;
    } catch {
      // Response body wasn't JSON; fall back to the generic message above.
    }

    // Log the full picture server-side (visible in the `npm run dev`
    // terminal) even though the HTTP status we return to the browser is
    // simplified — this is what to check first when a search fails.
    console.error(
      `[LEAD] Google Places API error: HTTP ${response.status}${
        googleStatus ? ` (${googleStatus})` : ""
      } — ${message}`
    );

    // Surface the most common setup mistakes clearly, since this is
    // likely the first time this key has been used against this API.
    if (response.status === 403) {
      message +=
        " This usually means the 'Places API (New)' is not enabled for your project, or the API key is restricted from calling it. Check Google Cloud Console > APIs & Services.";
    }
    if (response.status === 400) {
      message += " Check that the location, business type, and map radius look like a valid search.";
    }

    // Pass through Google's actual status where it's meaningful (400 =
    // bad request from us, 403 = auth/config problem) instead of always
    // reporting 502, so the browser's network tab reflects the real cause.
    const statusToReport = response.status === 400 ? 400 : 502;
    throw new GooglePlacesError(message, statusToReport);
  }

  const data = (await response.json()) as GooglePlacesSearchResponse;
  const places = data.places ?? [];
  return places.map((place) => toLeadResult(place, fallbackCategory));
}
