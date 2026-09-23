// Shape of a single business as LEAD returns it to the frontend.
export interface LeadResult {
  id: string;
  name: string;
  category: string;
  address: string;
  phone: string | null;
  rating: number | null;
  reviewCount: number | null;
  googleMapsUri: string | null;
  websiteUri: string | null;
  hasWebsite: boolean;
}

// Optional lat/lng/radius circle used to restrict a Places search to a
// hand-drawn area on the map, instead of (or on top of) a typed location.
export interface SearchCircle {
  lat: number;
  lng: number;
  radiusMeters: number;
}

// The heuristic bucket a business's own website falls into. "unreachable"
// is folded into "bad" for filtering purposes but kept distinct in the
// reasons shown to the user.
export type WebsiteQualityStatus = "good" | "okay" | "bad" | "unreachable";

export interface WebsiteQualityResult {
  placeId: string;
  status: WebsiteQualityStatus;
  score: number;
  reasons: string[];
}

// The subset of the Google Places API (New) "Place" object we request
// via field mask. Every other field Google can return is left off on
// purpose to keep each request small.
export interface GooglePlace {
  id: string;
  displayName?: { text: string; languageCode?: string };
  primaryTypeDisplayName?: { text: string; languageCode?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  websiteUri?: string;
}

export interface GooglePlacesSearchResponse {
  places?: GooglePlace[];
}

export interface GooglePlacesErrorResponse {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}
