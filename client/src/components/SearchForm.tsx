import { FormEvent, useState } from "react";
import { RadiusMap } from "./RadiusMap";
import type { SearchCircle } from "../types";

interface SearchFormProps {
  onSearch: (location: string, businessType: string, circle: SearchCircle | null) => void;
  isLoading: boolean;
}

export function SearchForm({ onSearch, isLoading }: SearchFormProps) {
  const [location, setLocation] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [useRadius, setUseRadius] = useState(false);
  const [circle, setCircle] = useState<SearchCircle | null>(null);
  const [radiusLabel, setRadiusLabel] = useState<string | null>(null);

  function handleRadiusChange(nextCircle: SearchCircle, label?: string) {
    setCircle(nextCircle);
    if (label) {
      setRadiusLabel(label);
      setValidationError(null);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (useRadius) {
      if (!circle) {
        setValidationError("Search or drag the map to choose an area first.");
        return;
      }
      setValidationError(null);
      onSearch(radiusLabel ?? "this area", businessType, circle);
      return;
    }

    const trimmed = location.trim();
    if (!trimmed) {
      setValidationError("Enter a ZIP code, city, or address to search.");
      return;
    }
    setValidationError(null);
    onSearch(trimmed, businessType, null);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="grid gap-4 sm:grid-cols-[2fr,2fr,auto] sm:items-end">
        <label className="block">
          <span className="block text-sm text-ink-soft mb-1.5">Location</span>
          {useRadius ? (
            <div className="flex h-[42px] items-center border border-rule bg-white px-3 text-sm text-ink-soft">
              {radiusLabel ?? "Search or drag the map below"}
            </div>
          ) : (
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Christiansburg, VA or 24060"
              className="w-full border border-rule bg-white px-3 py-2.5 text-ink placeholder:text-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-signal/40 focus:border-signal"
              aria-invalid={Boolean(validationError)}
            />
          )}
        </label>

        <label className="block">
          <span className="block text-sm text-ink-soft mb-1.5">
            Business type <span className="text-ink-soft/70">(optional)</span>
          </span>
          <input
            type="text"
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value)}
            placeholder="Restaurants, plumbers, roofers…"
            className="w-full border border-rule bg-white px-3 py-2.5 text-ink placeholder:text-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-signal/40 focus:border-signal"
          />
        </label>

        <button
          type="submit"
          disabled={isLoading}
          className="bg-ink text-paper px-6 py-2.5 font-medium transition-colors hover:bg-signal disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "Searching…" : "Search for leads"}
        </button>
      </div>

      <button
        type="button"
        onClick={() => setUseRadius((v) => !v)}
        className="mt-3 text-sm text-ink-soft underline decoration-rule underline-offset-4 hover:text-signal hover:decoration-signal"
      >
        {useRadius ? "Switch to typed location" : "Search a specific area on the map"}
      </button>

      {useRadius && <RadiusMap onChange={handleRadiusChange} />}

      {validationError && (
        <p className="mt-2 text-sm text-signal" role="alert">
          {validationError}
        </p>
      )}
    </form>
  );
}
