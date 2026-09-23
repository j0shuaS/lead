export type WebsiteQualityStatus = "good" | "okay" | "bad" | "unreachable";

export interface WebsiteQualityResult {
  placeId: string;
  status: WebsiteQualityStatus;
  score: number;
  reasons: string[];
}

// Tracked locally in the browser only — resets on refresh. There's no
// backend persistence for this (deliberately no database in this build).
export type LeadStatus = "new" | "contacted" | "interested" | "not_interested" | "closed";

// Exactly what the backend returns for a business.
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

// A LeadResult plus client-only state layered on top after search.
export interface TrackedLead extends LeadResult {
  quality?: WebsiteQualityResult | "checking";
  status: LeadStatus;
  notes: string;
}

export interface SearchCircle {
  lat: number;
  lng: number;
  radiusMeters: number;
}

export interface SearchResponse {
  query: { location: string; businessType: string | null; circle: SearchCircle | null };
  count: number;
  results: LeadResult[];
}

export interface ApiErrorBody {
  error: string;
}

// The combined "how promising is this lead" filter shown in the UI.
export type LeadFilter = "all" | "no-website" | "bad-website" | "okay-website" | "good-website";
