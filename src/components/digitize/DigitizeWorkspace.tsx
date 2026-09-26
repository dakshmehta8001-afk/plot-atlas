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
import { MAP_VIEWBOX_SIZE, type MapCalibration, type PolygonPoint } from "@/lib/types";
import { uploadPlanImage, setProjectCalibration } from "@/lib/actions/projects";
import { saveDigitizedShapes } from "@/lib/actions/digitize";
import { useDetectionPipeline, loadFileToCanvas } from "@/lib/digitize/useDetectionPipeline";
import type { DetectedShape } from "@/lib/digitize/types";
import { feetPerUnit, quadEdgeLengthsFt, formatDimensions, polygonAreaSqft, northAngleFromPoints } from "@/lib/calibration";
import { UploadDropzone } from "./UploadDropzone";
import { CornerWarpTool } from "./CornerWarpTool";
import { ProcessingProgress } from "./ProcessingProgress";
import { ReviewCanvas, type ReviewCanvasHandle } from "./ReviewCanvas";
import { Toolbar, type ToolMode } from "./Toolbar";
import { ShapeDetailsPanel } from "./ShapeDetailsPanel";
import { ColorLegendAssist } from "./ColorLegendAssist";
import { CountsHeader } from "./CountsHeader";
import { Legend } from "./Legend";
import { SearchPlotNumber } from "./SearchPlotNumber";
import { ExportMenu } from "./ExportMenu";
import { useUndoRedo } from "./useUndoRedo";

const VB = MAP_VIEWBOX_SIZE;

// Computed once per points-change, inline in whichever handler changed
// them (never in a useEffect — recomputing here means a plain event-driven
// state update, not an effect reacting to its own output, so there's no
// risk of the kind of render loop/lint issue an effect-based version would
// need to guard against). null calibration or a non-quad shape both
// resolve to needsDimensionReview: true — see calibration.ts's own doc
// comments for why each function returns null in those cases.
function computeDimensionFields(
  points: PolygonPoint[],
  calibration: MapCalibration | null,
  vbWidth: number,
  vbHeight: number,
): { dimensions?: string; areaSqft?: number; needsDimensionReview: boolean } {
  if (!calibration) return { needsDimensionReview: true };
  const perUnit = feetPerUnit(calibration.pointA, calibration.pointB, calibration.realDistanceFt, vbWidth, vbHeight);
  if (!perUnit) return { needsDimensionReview: true };
  const areaSqft = polygonAreaSqft(points, perUnit, vbWidth, vbHeight);
  const edges = quadEdgeLengthsFt(points, perUnit, vbWidth, vbHeight);
  if (!edges) return { areaSqft, needsDimensionReview: true };
  return { dimensions: formatDimensions(edges.widthFt, edges.heightFt), areaSqft, needsDimensionReview: false };
}

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
  initialCalibration,
}: {
  projectId: string;
  projectName: string;
  hasExistingPlanImage: boolean;
  initialCalibration: MapCalibration | null;
}) {
  const router = useRouter();
  const { stage: pipelineStage, error: pipelineError, run, reset } = useDetectionPipeline();

  const [stage, setStage] = useState<Stage>("upload");
  const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(null);
  const [sourceCanvas, setSourceCanvas] = useState<HTMLCanvasElement | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [calibration, setCalibration] = useState<MapCalibration | null>(initialCalibration);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  // The SAME aspect-ratio correction the two public viewers use (vbHeight
  // derived from the real image's aspect ratio, not a fixed square) — this
  // is ONLY for the calibration/dimension MATH below, not for how
  // ReviewCanvas itself visually renders (which deliberately stays on the
  // digitize editor's original, unchanged square-viewBox convention; see
  // the note in ReviewCanvas.tsx's own file comment). Feeding the square-
  // viewBox's raw fractional points into calibration.ts's functions
  // without this correction would silently compute wrong real-world
  // distances/angles whenever the source image isn't itself perfectly
  // square, since x and y fractions wouldn't represent the same real
  // screen distance on both axes.
  const aspectRatio = sourceCanvas ? sourceCanvas.width / sourceCanvas.height : 1;
  const vbHeight = VB / aspectRatio;

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
    // Computed from outcome.sourceCanvas directly, not the sourceCanvas/
    // vbHeight state/closure variables above — those still reflect the
    // PREVIOUS render (setSourceCanvas below hasn't taken effect yet), and
    // this project might already have a calibration from an earlier
    // digitize pass (re-running detection doesn't reset it), so freshly
    // detected plots should get real computed dimensions immediately
    // rather than all starting "needs review" until individually touched.
    const freshAspectRatio = outcome.sourceCanvas.width / outcome.sourceCanvas.height;
    const freshVbHeight = VB / freshAspectRatio;
    shapesState.set(
      outcome.result.shapes.map((s) =>
        s.kind === "plot" ? { ...s, ...computeDimensionFields(s.points, calibration, VB, freshVbHeight) } : s,
      ),
    );
    setSourceCanvas(outcome.sourceCanvas);
    setWarnings(outcome.result.warnings);
    setStage("review");
  }

  function handleUpdatePoints(id: string, points: PolygonPoint[]) {
    shapesState.set(
      shapesState.value.map((s) => {
        if (s.localId !== id) return s;
        if (s.kind !== "plot") return { ...s, points };
        return { ...s, points, ...computeDimensionFields(points, calibration, VB, vbHeight) };
      }),
    );
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
    // Computed fresh for each half from ITS OWN new geometry — the split
    // changed the shape, so anything the parent had computed is stale for
    // both halves regardless of what it was before (a quad the reviewer
    // just cut in half often becomes two clean quads too, so this is
    // frequently NOT stuck needing review — no reason to force that).
    const childA: DetectedShape = {
      ...original,
      localId: crypto.randomUUID(),
      points: pointsA,
      label: "",
      source: "manual",
      confidence: undefined,
      ...computeDimensionFields(pointsA, calibration, VB, vbHeight),
    };
    const childB: DetectedShape = {
      ...original,
      localId: crypto.randomUUID(),
      points: pointsB,
      label: "",
      source: "manual",
      confidence: undefined,
      ...computeDimensionFields(pointsB, calibration, VB, vbHeight),
    };
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
      ...(kind === "plot" ? computeDimensionFields(points, calibration, VB, vbHeight) : { needsDimensionReview: false }),
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
  function handleApplyCategory(localIds: string[], category: string) {
    const idSet = new Set(localIds);
    shapesState.set(shapesState.value.map((s) => (idSet.has(s.localId) ? { ...s, category } : s)));
  }

  // The two calibration gestures (see ReviewCanvas's set-scale/set-north
  // modes) both funnel through here. Setting/changing the SCALE
  // recomputes every plot's dimensions (the scale factor itself just
  // changed, so anything computed under the old one is now wrong) and
  // persists the new calibration to the project row immediately — not
  // deferred to "Save to project" — since it's project-level configuration,
  // not a shape, and a reviewer re-running detection or navigating away
  // shouldn't lose it.
  async function handleSetScale(pointA: PolygonPoint, pointB: PolygonPoint, realDistanceFt: number) {
    setCalibrationError(null);
    const perUnit = feetPerUnit(pointA, pointB, realDistanceFt, VB, vbHeight);
    if (!perUnit) {
      setCalibrationError("Those two points are too close together to calibrate against — pick two points further apart.");
      return;
    }
    const next: MapCalibration = { pointA, pointB, realDistanceFt, northAngleDegrees: calibration?.northAngleDegrees ?? null };
    setCalibration(next);
    shapesState.set(
      shapesState.value.map((s) => (s.kind === "plot" ? { ...s, ...computeDimensionFields(s.points, next, VB, vbHeight) } : s)),
    );
    const result = await setProjectCalibration(projectId, next);
    if (result.error) setCalibrationError(`Scale reference set locally, but saving it to the project failed: ${result.error}`);
  }

  async function handleSetNorth(pointA: PolygonPoint, pointB: PolygonPoint) {
    setCalibrationError(null);
    if (!calibration) {
      setCalibrationError("Set a scale reference first (Toolbar → Set scale) — north angle is stored alongside it.");
      return;
    }
    const northAngleDegrees = northAngleFromPoints(pointA, pointB, VB, vbHeight);
    const next: MapCalibration = { ...calibration, northAngleDegrees };
    setCalibration(next);
    const result = await setProjectCalibration(projectId, next);
    if (result.error) setCalibrationError(`North direction set locally, but saving it to the project failed: ${result.error}`);
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
          dimensions: s.dimensions,
          areaSqft: s.areaSqft,
          category: s.category,
          needsDimensionReview: s.needsDimensionReview,
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

  const needsReviewCount = shapesState.value.filter((s) => s.kind === "plot" && s.needsDimensionReview).length;

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
      {calibrationError && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{calibrationError}</p>
      )}
      {!calibration ? (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          No scale reference yet — use Toolbar → Set scale (click two points a known distance apart, e.g. a labeled road&apos;s
          width) to get exact plot dimensions. Required before this project can be published.
        </p>
      ) : (
        needsReviewCount > 0 && (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {needsReviewCount} plot{needsReviewCount === 1 ? "" : "s"} still need{needsReviewCount === 1 ? "s" : ""} dimensions
            confirmed (not a clean 4-point shape) — select each one to enter it by hand. Required before publishing.
          </p>
        )
      )}

      <ColorLegendAssist shapes={shapesState.value} sourceCanvas={sourceCanvas} onApplyCategory={handleApplyCategory} />

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
          onModeChange={setMode}
          showOriginal={showOriginal}
          originalOpacity={originalOpacity}
          calibration={calibration}
          onSetScale={handleSetScale}
          onSetNorth={handleSetNorth}
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
