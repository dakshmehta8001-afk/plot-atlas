"use client";

// Top-level state machine for the auto-digitize flow: upload → (optional)
// straighten → detect → review & edit → save. Mounted via next/dynamic with
// ssr:false from the route (see app/dashboard/projects/[id]/digitize/
// page.tsx) since OpenCV's WASM module isn't safe to evaluate during RSC
// prerendering.
//
// Known limitation, stated plainly rather than half-building it: there is
// no autosave of an in-progress review. Persisting `shapes` alone to
// localStorage would be easy, but without the source image alongside it
// (too large for localStorage, and IndexedDB support for that was cut from
// this pass) a restored draft couldn't actually be re-displayed — a
// "save" that can't be shown back is worse than no save at all. The
// reviewer is warned on screen; "Save to project" is the only durable step.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PolygonPoint } from "@/lib/types";
import { uploadPlanImage } from "@/lib/actions/projects";
import { saveDigitizedShapes } from "@/lib/actions/digitize";
import { useDetectionPipeline, loadFileToCanvas } from "@/lib/digitize/useDetectionPipeline";
import type { DetectedShape } from "@/lib/digitize/types";
import { UploadDropzone } from "./UploadDropzone";
import { CornerWarpTool } from "./CornerWarpTool";
import { ProcessingProgress } from "./ProcessingProgress";
import { ReviewCanvas, type ReviewCanvasHandle } from "./ReviewCanvas";
import { Toolbar, type ToolMode } from "./Toolbar";
import { ShapeDetailsPanel } from "./ShapeDetailsPanel";
import { CountsHeader } from "./CountsHeader";
import { Legend } from "./Legend";
import { SearchPlotNumber } from "./SearchPlotNumber";
import { ExportMenu } from "./ExportMenu";
import { useUndoRedo } from "./useUndoRedo";

type Stage = "upload" | "warp" | "processing" | "review" | "saving" | "done";

function canvasToFile(canvas: HTMLCanvasElement, filename: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not export the straightened image."));
        return;
      }
      resolve(new File([blob], filename, { type: "image/png" }));
    }, "image/png");
  });
}

export function DigitizeWorkspace({
  projectId,
  projectName,
  hasExistingPlanImage,
}: {
  projectId: string;
  projectName: string;
  hasExistingPlanImage: boolean;
}) {
  const router = useRouter();
  const { stage: pipelineStage, error: pipelineError, run, reset } = useDetectionPipeline();

  const [stage, setStage] = useState<Stage>("upload");
  const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(null);
  const [sourceCanvas, setSourceCanvas] = useState<HTMLCanvasElement | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  const shapesState = useUndoRedo<DetectedShape[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<ToolMode>("select");
  const [showOriginal, setShowOriginal] = useState(true);
  const [originalOpacity, setOriginalOpacity] = useState(0.6);

  const canvasRef = useRef<ReviewCanvasHandle>(null);
  const selectedShape = shapesState.value.find((s) => s.localId === selectedId) ?? null;

  async function handleStart(file: File) {
    try {
      const canvas = await loadFileToCanvas(file);
      setPreviewCanvas(canvas);
      setStage("warp");
    } catch (err) {
      setPreviewCanvas(null);
      setStage("upload");
      // The pipeline hook's own error state doubles for this too, so the
      // upload step's failure gets the same visible treatment as a
      // detection failure rather than a silently swallowed exception.
      console.error(err);
    }
  }

  async function runDetection(canvas: HTMLCanvasElement) {
    setStage("processing");
    const outcome = await run({ canvas });
    if (!outcome) {
      // useDetectionPipeline already set its own `error`/`stage: "error"` —
      // ProcessingProgress's caller (below) shows that state with a retry.
      return;
    }
    shapesState.set(outcome.result.shapes);
    setSourceCanvas(outcome.sourceCanvas);
    setWarnings(outcome.result.warnings);
    setStage("review");
  }

  function handleUpdatePoints(id: string, points: PolygonPoint[]) {
    shapesState.set(shapesState.value.map((s) => (s.localId === id ? { ...s, points } : s)));
  }
  function handleChangeShape(next: DetectedShape) {
    shapesState.set(shapesState.value.map((s) => (s.localId === next.localId ? next : s)));
  }
  function handleDeleteSelected() {
    if (!selectedId) return;
    shapesState.set(shapesState.value.filter((s) => s.localId !== selectedId));
    setSelectedId(null);
  }
  // The Split tool's payoff: turning one detected-but-merged blob (the
  // known failure mode when a plan's internal dividing lines are too thin
  // to survive automatic detection — see the memory notes on this feature)
  // into two separate, individually-editable plots, without re-tracing
  // either one by hand. Both halves lose the original's label/confidence
  // (a wrong-but-confident label carried over onto BOTH new plots would be
  // worse than two blank ones) and get marked "manual", since the split
  // itself was a reviewer action, not something detection produced.
  function handleSplitShape(id: string, parts: [PolygonPoint[], PolygonPoint[]]) {
    const original = shapesState.value.find((s) => s.localId === id);
    if (!original) return;
    const [pointsA, pointsB] = parts;
    const childA: DetectedShape = { ...original, localId: crypto.randomUUID(), points: pointsA, label: "", source: "manual", confidence: undefined };
    const childB: DetectedShape = { ...original, localId: crypto.randomUUID(), points: pointsB, label: "", source: "manual", confidence: undefined };
    shapesState.set(shapesState.value.flatMap((s) => (s.localId === id ? [childA, childB] : [s])));
    setSelectedId(null);
  }
  function handleAddShape(kind: "plot" | "road" | "feature", points: PolygonPoint[]) {
    const shape: DetectedShape = {
      localId: crypto.randomUUID(),
      kind,
      points,
      label: "",
      status: kind === "plot" ? "available" : undefined,
      featureKind: kind === "feature" ? "other" : undefined,
      source: "manual",
    };
    shapesState.set([...shapesState.value, shape]);
    setSelectedId(shape.localId);
    setMode("select");
  }
  function handleFound(shape: DetectedShape) {
    setSelectedId(shape.localId);
    setMode("select");
    canvasRef.current?.focusOnPoints(shape.points);
  }

  async function handleSave() {
    if (!sourceCanvas) return;
    setSaveError(null);
    setStage("saving");
    try {
      if (!hasExistingPlanImage) {
        const file = await canvasToFile(sourceCanvas, "digitized-plan.png");
        const uploadResult = await uploadPlanImage(projectId, file);
        if (uploadResult.error) {
          setSaveError(`Saving the plan image failed: ${uploadResult.error}`);
          setStage("review");
          return;
        }
      }

      const result = await saveDigitizedShapes({
        projectId,
        shapes: shapesState.value.map((s) => ({
          kind: s.kind,
          points: s.points,
          label: s.label || (s.kind === "road" ? "Road" : s.kind === "feature" ? "Area" : "Unlabeled"),
          status: s.status,
          featureKind: s.featureKind,
        })),
      });
      if (result.error) {
        setSaveError(result.error);
        setStage("review");
        return;
      }
      setSavedCount(result.created ?? shapesState.value.length);
      setStage("done");
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Saving failed unexpectedly.");
      setStage("review");
    }
  }

  if (stage === "upload") {
    return <UploadDropzone onStart={handleStart} />;
  }

  if (stage === "warp" && previewCanvas) {
    return (
      <CornerWarpTool
        sourceCanvas={previewCanvas}
        onComplete={(warped) => runDetection(warped)}
        onSkip={() => runDetection(previewCanvas)}
      />
    );
  }

  if (stage === "processing" || pipelineStage === "error") {
    if (pipelineStage === "error") {
      return (
        <div className="flex min-h-[500px] flex-col items-center justify-center gap-4 rounded-lg border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-gray-900">
          <p className="font-medium text-red-600">{pipelineError ?? "Detection failed."}</p>
          <button
            type="button"
            onClick={() => {
              reset();
              setStage("upload");
            }}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-gray-900"
          >
            Try a different file
          </button>
        </div>
      );
    }
    return <ProcessingProgress stage={pipelineStage} />;
  }

  if (stage === "done") {
    return (
      <div className="flex min-h-[500px] flex-col items-center justify-center gap-3 rounded-lg border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-gray-900">
        <p className="text-lg font-medium">Saved {savedCount} shape(s) to the project.</p>
        <p className="text-sm text-gray-500">They now appear alongside anything traced manually — from here they work exactly the same way.</p>
        <a href={`/dashboard/projects/${projectId}`} className="mt-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-gray-900">
          Back to project
        </a>
      </div>
    );
  }

  // stage === "review" (or "saving", which reuses the same screen with its button disabled)
  if (!sourceCanvas) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CountsHeader shapes={shapesState.value} />
        <SearchPlotNumber shapes={shapesState.value} onFound={handleFound} />
      </div>

      {warnings.length > 0 && (
        <div className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}
      {saveError && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{saveError}</p>}

      <Toolbar
        mode={mode}
        onModeChange={setMode}
        onDeleteSelected={handleDeleteSelected}
        canDeleteSelected={!!selectedId}
        onUndo={shapesState.undo}
        onRedo={shapesState.redo}
        canUndo={shapesState.canUndo}
        canRedo={shapesState.canRedo}
      />

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} className="accent-gray-900" />
          Original plan
        </label>
        {showOriginal && (
          <label className="flex items-center gap-2">
            Opacity
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={originalOpacity}
              onChange={(e) => setOriginalOpacity(Number(e.target.value))}
            />
          </label>
        )}
        <Legend />
      </div>

      <div className="grid h-[600px] grid-cols-1 gap-3 lg:grid-cols-[1fr_280px]">
        <ReviewCanvas
          ref={canvasRef}
          sourceCanvas={sourceCanvas}
          shapes={shapesState.value}
          selectedId={selectedId}
          onSelect={setSelectedId}
          mode={mode}
          onUpdateShape={handleUpdatePoints}
          onAddShape={handleAddShape}
          onSplitShape={handleSplitShape}
          showOriginal={showOriginal}
          originalOpacity={originalOpacity}
        />
        <div className="lg:h-full">
          {selectedShape ? (
            <ShapeDetailsPanel shape={selectedShape} onChange={handleChangeShape} onDelete={handleDeleteSelected} />
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400 dark:border-gray-700">
              Select a shape to edit its details, or use the toolbar to draw a new one.
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-3 dark:border-gray-800">
        <ExportMenu shapes={shapesState.value} projectName={projectName} />
        <button
          type="button"
          disabled={stage === "saving" || shapesState.value.length === 0}
          onClick={handleSave}
          className="rounded-md bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900"
        >
          {stage === "saving" ? "Saving…" : `Save ${shapesState.value.length} shape(s) to project`}
        </button>
      </div>
      <p className="text-center text-xs text-gray-400">
        Nothing is saved until you click Save — don&apos;t refresh or navigate away before then.
      </p>
    </div>
  );
}
