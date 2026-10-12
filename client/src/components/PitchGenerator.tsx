import { FormEvent, useState } from "react";
import { generatePitch } from "../api";
import type { PitchResult } from "../types";

type Status = "idle" | "loading" | "error" | "success";

// The second half of LEAD's loop: for a business that DOES have a
// website, paste its URL here and get back a summary of what they do
// plus a pitch for why an AI chatbot on their site would help them —
// grounded in what's actually on the page, not a generic sales line.
export function PitchGenerator() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<PitchResult | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = url.trim();

    if (!trimmed) {
      setErrorMessage("Enter a website URL first.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setErrorMessage(null);

    try {
      const pitch = await generatePitch(trimmed);
      setResult(pitch);
      setStatus("success");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="block text-sm text-ink-soft mb-1.5">Business website URL</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full border border-rule bg-white px-3 py-2.5 text-ink placeholder:text-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-signal/40 focus:border-signal"
            aria-invalid={status === "error"}
          />
        </label>

        <button
          type="submit"
          disabled={status === "loading"}
          className="bg-ink text-paper px-6 py-2.5 font-medium transition-colors hover:bg-signal disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === "loading" ? "Generating…" : "Generate pitch"}
        </button>
      </form>

      {status === "error" && errorMessage && (
        <p className="mt-3 text-sm text-signal" role="alert">
          {errorMessage}
        </p>
      )}

      {status === "loading" && (
        <div className="mt-8 border border-rule bg-white p-5" aria-live="polite" aria-busy="true">
          <div className="h-3 w-1/3 animate-pulse bg-rule" />
          <div className="mt-4 h-4 w-2/3 animate-pulse bg-rule" />
          <div className="mt-2 h-3 w-full animate-pulse bg-rule" />
          <div className="mt-2 h-3 w-5/6 animate-pulse bg-rule" />
        </div>
      )}

      {status === "success" && result && (
        <div className="mt-8 border border-rule bg-white p-5">
          <p className="font-mono text-xs text-ink-soft break-all">{result.url}</p>

          <h3 className="mt-4 font-display text-lg text-ink">What they do</h3>
          <p className="mt-1 text-sm text-ink-soft">{result.summary}</p>

          <h3 className="mt-5 font-display text-lg text-ink">Chatbot pitch</h3>
          <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{result.pitch}</p>
        </div>
      )}
    </div>
  );
}
