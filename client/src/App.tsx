import { useState } from "react";
import { checkWebsiteQuality, searchLeads } from "./api";
import { PitchGenerator } from "./components/PitchGenerator";
import { ResultsList } from "./components/ResultsList";
import { SearchForm } from "./components/SearchForm";
import type { LeadFilter, LeadStatus, SearchCircle, TrackedLead } from "./types";

type Status = "idle" | "loading" | "error" | "success";
type Tab = "leads" | "pitch";

export default function App() {
  const [tab, setTab] = useState<Tab>("leads");
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

  const tabButtonClass = (isActive: boolean) =>
    isActive
      ? "border-b-2 border-ink px-1 pb-3 text-sm font-medium text-ink"
      : "border-b-2 border-transparent px-1 pb-3 text-sm text-ink-soft transition-colors hover:text-ink";

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

        <nav className="mt-8 flex gap-6 border-b border-rule" aria-label="LEAD sections">
          <button type="button" onClick={() => setTab("leads")} className={tabButtonClass(tab === "leads")}>
            Find leads
          </button>
          <button type="button" onClick={() => setTab("pitch")} className={tabButtonClass(tab === "pitch")}>
            Chatbot pitch generator
          </button>
        </nav>

        {tab === "leads" ? (
          <>
            <div className="mt-6">
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
          </>
        ) : (
          <div className="mt-6">
            <p className="max-w-2xl text-sm text-ink-soft">
              For a business that DOES have a website, paste its URL here. LEAD summarizes what
              they do and drafts a pitch for adding an AI chatbot to their site — so you can
              follow up with the ones that already have a site, not just the ones that don't.
            </p>
            <div className="mt-5">
              <PitchGenerator />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
