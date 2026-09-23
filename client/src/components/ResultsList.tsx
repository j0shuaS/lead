import type { LeadFilter, LeadStatus, TrackedLead } from "../types";
import { BusinessCard } from "./BusinessCard";
import { FilterBar } from "./FilterBar";

interface ResultsListProps {
  status: "idle" | "loading" | "error" | "success";
  results: TrackedLead[];
  errorMessage: string | null;
  searchedLocation: string | null;
  filter: LeadFilter;
  onFilterChange: (filter: LeadFilter) => void;
  onStatusChange: (business: TrackedLead, status: LeadStatus, notes: string) => void;
}

function bucketOf(business: TrackedLead): LeadFilter | null {
  if (!business.hasWebsite) return "no-website";
  if (!business.quality || business.quality === "checking") return null;
  if (business.quality.status === "good") return "good-website";
  if (business.quality.status === "okay") return "okay-website";
  return "bad-website"; // bad or unreachable
}

export function ResultsList({
  status,
  results,
  errorMessage,
  searchedLocation,
  filter,
  onFilterChange,
  onStatusChange,
}: ResultsListProps) {
  if (status === "idle") {
    return null;
  }

  if (status === "loading") {
    return (
      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite" aria-busy="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="border border-rule bg-white p-5">
            <div className="h-1.5 w-1/3 animate-pulse bg-rule" />
            <div className="mt-4 space-y-2">
              <div className="h-4 w-2/3 animate-pulse bg-rule" />
              <div className="h-3 w-1/2 animate-pulse bg-rule" />
              <div className="h-3 w-1/3 animate-pulse bg-rule" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="mt-10 border border-signal/40 bg-signal/10 px-5 py-4" role="alert">
        <p className="font-medium text-ink">Search failed</p>
        <p className="mt-1 text-sm text-ink-soft">{errorMessage}</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="mt-10 border border-rule px-5 py-8 text-center">
        <p className="font-display text-lg text-ink">No businesses found</p>
        <p className="mt-1 text-sm text-ink-soft">
          Try a broader location{searchedLocation ? ` than "${searchedLocation}"` : ""}, or drop
          the business type to search more broadly.
        </p>
      </div>
    );
  }

  const counts: Record<LeadFilter, number> = {
    all: results.length,
    "no-website": 0,
    "bad-website": 0,
    "okay-website": 0,
    "good-website": 0,
  };
  for (const business of results) {
    const bucket = bucketOf(business);
    if (bucket) counts[bucket] += 1;
  }

  const visible = filter === "all" ? results : results.filter((b) => bucketOf(b) === filter);

  return (
    <div className="mt-10">
      <FilterBar filter={filter} onChange={onFilterChange} counts={counts} />

      {visible.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">No businesses match this filter.</p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((business) => (
            <BusinessCard
              key={business.id}
              business={business}
              onStatusChange={(newStatus, notes) => onStatusChange(business, newStatus, notes)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
