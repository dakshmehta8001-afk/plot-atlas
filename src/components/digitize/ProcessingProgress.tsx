"use client";

import { STAGE_COPY, type PipelineStage } from "@/lib/digitize/types";

const STAGE_ORDER: PipelineStage[] = [
  "loading-engine",
  "preparing",
  "detecting-layout",
  "detecting-roads",
  "detecting-plots",
  "reading-labels",
  "building-map",
];

export function ProcessingProgress({ stage }: { stage: PipelineStage }) {
  const currentIndex = STAGE_ORDER.indexOf(stage);

  return (
    <div className="flex min-h-[500px] flex-col items-center justify-center gap-6 rounded-lg border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-gray-900">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900 dark:border-gray-700 dark:border-t-white" />
      <div>
        <p className="text-lg font-medium">{STAGE_COPY[stage]}</p>
        <p className="mt-1 text-sm text-gray-500">
          Automatic detection + manual correction — this finds a rough first draft, not a finished map.
        </p>
      </div>
      <ol className="space-y-1.5 text-sm">
        {STAGE_ORDER.map((s, i) => (
          <li
            key={s}
            className={
              i < currentIndex
                ? "text-green-600 dark:text-green-400"
                : i === currentIndex
                  ? "font-medium text-gray-900 dark:text-white"
                  : "text-gray-400 dark:text-gray-600"
            }
          >
            {i < currentIndex ? "✓ " : i === currentIndex ? "→ " : "· "}
            {STAGE_COPY[s]}
          </li>
        ))}
      </ol>
    </div>
  );
}
