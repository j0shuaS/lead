import type { LeadStatus, TrackedLead, WebsiteQualityResult } from "../types";
import { StatusControl } from "./StatusControl";

interface BusinessCardProps {
  business: TrackedLead;
  onStatusChange: (status: LeadStatus, notes: string) => void;
}

const QUALITY_LABEL: Record<WebsiteQualityResult["status"], string> = {
  good: "Good website",
  okay: "Okay website",
  bad: "Bad website",
  unreachable: "Site unreachable",
};

// Every accent-bar / bar-fill color in this card maps to one of these four
// buckets, so color is always carrying the same meaning across the card.
function accentClass(business: TrackedLead): string {
  if (!business.hasWebsite) return "bg-signal";
  if (!business.quality || business.quality === "checking") return "bg-silver";
  if (business.quality.status === "good") return "bg-confirmed";
  if (business.quality.status === "okay") return "bg-okay";
  return "bg-signal";
}

function QualityBar({ quality }: { quality: TrackedLead["quality"] }) {
  if (!quality) return null;

  if (quality === "checking") {
    return (
      <div className="mt-3">
        <div className="h-1.5 w-full overflow-hidden bg-rule">
          <div className="h-full w-1/3 animate-pulse bg-silver" />
        </div>
        <p className="mt-1 text-xs text-ink-soft">Checking website…</p>
      </div>
    );
  }

  const barColor =
    quality.status === "good" ? "bg-confirmed" : quality.status === "okay" ? "bg-okay" : "bg-signal";

  return (
    <div className="mt-3">
      <div className="h-1.5 w-full overflow-hidden bg-rule">
        <div className={`h-full ${barColor}`} style={{ width: `${quality.score}%` }} />
      </div>
      <p className="mt-1 text-xs text-ink-soft">
        {QUALITY_LABEL[quality.status]} · {quality.reasons[0]}
      </p>
    </div>
  );
}

export function BusinessCard({ business, onStatusChange }: BusinessCardProps) {
  const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(
    `${business.name} ${business.address}`
  )}`;

  return (
    <li className="flex flex-col border border-rule bg-white">
      <span className={`h-1.5 w-full ${accentClass(business)}`} aria-hidden="true" />

      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <h3 className="font-display text-lg leading-snug text-ink">{business.name}</h3>
          {!business.hasWebsite && (
            <span className="whitespace-nowrap font-mono text-xs tracking-wide text-signal">
              No website
            </span>
          )}
        </div>

        <p className="mt-1 text-sm text-ink-soft">{business.category}</p>
        <p className="text-sm text-ink-soft">{business.address}</p>

        <p className="mt-2 font-mono text-sm text-ink-soft">
          {business.phone && <span>{business.phone}</span>}
          {business.phone && (business.rating !== null || business.googleMapsUri) && (
            <span> · </span>
          )}
          {business.rating !== null && (
            <span>
              {business.rating.toFixed(1)} rating
              {business.reviewCount !== null ? ` (${business.reviewCount})` : ""}
            </span>
          )}
        </p>

        {business.hasWebsite && <QualityBar quality={business.quality} />}

        <div className="mt-auto pt-4">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {business.googleMapsUri && (
              <a
                href={business.googleMapsUri}
                target="_blank"
                rel="noreferrer"
                className="lead-link text-sm"
              >
                View on Maps
              </a>
            )}
            <a
              href={googleSearchUrl}
              target="_blank"
              rel="noreferrer"
              className="lead-link text-sm"
            >
              Search on Google
            </a>
          </div>

          <StatusControl
            status={business.status}
            notes={business.notes}
            onChange={onStatusChange}
          />
        </div>
      </div>
    </li>
  );
}
