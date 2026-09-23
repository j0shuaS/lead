import type { LeadFilter } from "../types";

interface FilterBarProps {
  filter: LeadFilter;
  onChange: (filter: LeadFilter) => void;
  counts: Record<LeadFilter, number>;
}

const OPTIONS: { value: LeadFilter; label: string }[] = [
  { value: "all", label: "Results" },
  { value: "no-website", label: "No website" },
  { value: "bad-website", label: "Bad website" },
  { value: "okay-website", label: "Okay website" },
  { value: "good-website", label: "Good website" },
];

// A horizontal strip of stats that doubles as the filter control — each
// cell shows a live count and is clickable, so the numbers and the
// filtering share one piece of UI instead of two.
export function FilterBar({ filter, onChange, counts }: FilterBarProps) {
  return (
    <div
      role="group"
      aria-label="Filter results"
      className="flex flex-wrap divide-x divide-rule border border-rule bg-white"
    >
      {OPTIONS.map((option) => {
        const isActive = filter === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={
              isActive
                ? "flex-1 min-w-[110px] bg-ink px-4 py-3 text-left text-paper transition-colors"
                : "flex-1 min-w-[110px] px-4 py-3 text-left text-ink transition-colors hover:bg-paper"
            }
          >
            <span className="block font-display text-2xl">{counts[option.value]}</span>
            <span className={isActive ? "block text-xs text-paper/80" : "block text-xs text-ink-soft"}>
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
