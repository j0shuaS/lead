import { useState } from "react";
import type { LeadStatus } from "../types";

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  not_interested: "Not interested",
  closed: "Closed",
};

const STATUS_ORDER: LeadStatus[] = ["new", "contacted", "interested", "not_interested", "closed"];

interface StatusControlProps {
  status: LeadStatus;
  notes: string;
  onChange: (status: LeadStatus, notes: string) => void;
}

// Purely local state — nothing here is persisted to a server, so changes
// take effect immediately with no saving indicator needed.
export function StatusControl({ status, notes, onChange }: StatusControlProps) {
  const [notesDraft, setNotesDraft] = useState(notes);
  const [notesOpen, setNotesOpen] = useState(Boolean(notes));

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-rule pt-3">
      <select
        value={status}
        onChange={(e) => onChange(e.target.value as LeadStatus, notesDraft)}
        className="border border-rule bg-white px-2 py-1 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-signal/40"
      >
        {STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => setNotesOpen((v) => !v)}
        className="text-sm text-ink-soft underline decoration-rule underline-offset-4 hover:text-signal hover:decoration-signal"
      >
        {notesOpen ? "Hide note" : notes ? "Edit note" : "Add note"}
      </button>

      {notesOpen && (
        <textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={() => {
            if (notesDraft !== notes) onChange(status, notesDraft);
          }}
          placeholder="Notes on this lead…"
          rows={2}
          className="w-full border border-rule bg-white px-2 py-1.5 text-sm text-ink placeholder:text-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-signal/40"
        />
      )}
    </div>
  );
}
