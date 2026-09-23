import { useState } from "react";
import { checkWebsiteQuality, searchLeads } from "./api";
import { ResultsList } from "./components/ResultsList";
import { SearchForm } from "./components/SearchForm";
import type { LeadFilter, LeadStatus, SearchCircle, TrackedLead } from "./types";

type Status = "idle" | "loading" | "error" | "success";

export default function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<TrackedLead[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchedLocation, setSearchedLocation] = useState<string | null>(null);
  const [filter, setFilter] = useState<LeadFilter>("all");

  async function handleSearch(location: string, businessType: string, circle: SearchCircle | null) {
    setStatus("loading");
    setErrorMessage(null);
    setSearchedLocation(location);
    setFilter("all");

    try {
      const response = await searchLeads(location, businessType, circle);
      const tracked: TrackedLead[] = response.results.map((business) => ({
        ...business,
        quality: business.hasWebsite ? ("checking" as const) : undefined,
        status: "new",
        notes: "",
      }));
      setResults(tracked);
      setStatus("success");

      if (tracked.some((b) => b.hasWebsite)) {
        checkWebsiteQuality(tracked)
          .then((qualityResults) => {
            const byId = new Map(qualityResults.map((q) => [q.placeId, q]));
            setResults((current) =>
              current.map((business) =>
                business.hasWebsite
                  ? { ...business, quality: byId.get(business.id) ?? undefined }
                  : business
              )
            );
          })
          .catch(() => {
            setResults((current) =>
              current.map((business) =>
                business.quality === "checking" ? { ...business, quality: undefined } : business
              )
            );
          });
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  function handleStatusChange(business: TrackedLead, newStatus: LeadStatus, notes: string) {
    setResults((current) =>
      current.map((b) => (b.id === business.id ? { ...b, status: newStatus, notes } : b))
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <header className="flex flex-col gap-6 border-b border-rule pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-4xl text-ink">LEAD</h1>
            <p className="mt-1 text-ink-soft">Local Enterprise Acquisition Discovery</p>
          </div>
          <p className="max-w-sm text-sm text-ink sm:text-right">
            Find local businesses that don't have a website listed on their Google Business
            Profile — a place to start a conversation, not a guarantee they have no site
            anywhere.
          </p>
        </header>

        <div className="mt-8">
          <SearchForm onSearch={handleSearch} isLoading={status === "loading"} />
        </div>

        <ResultsList
          status={status}
          results={results}
          errorMessage={errorMessage}
          searchedLocation={searchedLocation}
          filter={filter}
          onFilterChange={setFilter}
          onStatusChange={handleStatusChange}
        />
      </div>
    </div>
  );
}
