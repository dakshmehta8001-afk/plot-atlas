"use client";

// The review canvas's tool-mode switcher. Deliberately its own component,
// not a reuse of PolygonTracer's `traceActions` button row — that model is
// "click a button, trace one shape, done"; this one is a persistent mode
// (select / draw / edit-points) the reviewer stays in across many shapes,
// which is a different interaction shape entirely.
export type ToolMode = "select" | "draw-plot" | "draw-road" | "draw-area" | "edit-points";

const TOOLS: { mode: ToolMode; label: string }[] = [
  { mode: "select", label: "Select" },
  { mode: "draw-plot", label: "Draw plot" },
  { mode: "draw-road", label: "Draw road" },
  { mode: "draw-area", label: "Draw area" },
  { mode: "edit-points", label: "Edit points" },
];

export function Toolbar({
  mode,
  onModeChange,
  onDeleteSelected,
  canDeleteSelected,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  mode: ToolMode;
  onModeChange: (mode: ToolMode) => void;
  onDeleteSelected: () => void;
  canDeleteSelected: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900">
      {TOOLS.map((tool) => (
        <button
          key={tool.mode}
          type="button"
          onClick={() => onModeChange(tool.mode)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            mode === tool.mode
              ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          }`}
        >
          {tool.label}
        </button>
      ))}
      <div className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" />
      <button
        type="button"
        onClick={onDeleteSelected}
        disabled={!canDeleteSelected}
        className="rounded-md bg-red-50 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-red-950 dark:text-red-400"
      >
        Delete
      </button>
      <div className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" />
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-800 dark:text-gray-200"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-800 dark:text-gray-200"
      >
        Redo
      </button>
    </div>
  );
}
