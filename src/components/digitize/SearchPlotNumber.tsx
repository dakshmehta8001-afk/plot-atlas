"use client";

// "Search plot number..." → find it, zoom to it, highlight it, open its
// details — per the user's spec. Finding + selecting happens here; the
// actual pan/zoom is delegated to ReviewCanvas's imperative focusOnPoints
// (via the ref DigitizeWorkspace passes through), since the canvas is the
// only thing that owns pan/zoom state.
import { useState } from "react";
import type { DetectedShape } from "@/lib/digitize/types";

export function SearchPlotNumber({
  shapes,
  onFound,
}: {
  shapes: DetectedShape[];
  onFound: (shape: DetectedShape) => void;
}) {
  const [query, setQuery] = useState("");
  const [notFound, setNotFound] = useState(false);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return;
    const match = shapes.find((s) => s.kind === "plot" && s.label.trim().toLowerCase() === trimmed);
    if (match) {
      setNotFound(false);
      onFound(match);
    } else {
      setNotFound(true);
    }
  }

  return (
    <form onSubmit={handleSearch} className="flex items-center gap-2">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setNotFound(false);
        }}
        placeholder="Search plot number…"
        className="w-40 rounded-md border border-gray-300 p-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
      />
      <button type="submit" className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700">
        Search
      </button>
      {notFound && <span className="text-xs text-red-500">No plot &quot;{query}&quot;</span>}
    </form>
  );
}
