"use client";

// Manual perspective-correction assist — NOT automatic perspective
// correction. Automatically detecting "which 4 points of this photo should
// form a rectangle" without any known reference (a printed plan has no
// fixed physical size or fiducial marker) isn't reliably solvable, so
// rather than guessing and quietly producing a warped mess, this asks the
// reviewer to tap the plan's 4 corners themselves — the one piece of
// information no algorithm here can infer on its own.
import { useMemo, useRef, useState } from "react";
import { loadOpenCv } from "@/lib/digitize/opencvLoader";

type Corner = { x: number; y: number };

export function CornerWarpTool({
  sourceCanvas,
  onComplete,
  onSkip,
}: {
  sourceCanvas: HTMLCanvasElement;
  onComplete: (canvas: HTMLCanvasElement) => void;
  onSkip: () => void;
}) {
  const [corners, setCorners] = useState<Corner[]>([]);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const dataUrl = useMemo(() => sourceCanvas.toDataURL("image/png"), [sourceCanvas]);

  function handleClick(e: React.MouseEvent<HTMLImageElement>) {
    if (corners.length >= 4) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setCorners((prev) => [...prev, { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }]);
  }

  async function applyWarp() {
    if (corners.length !== 4) return;
    setBusy(true);
    try {
      const cv = await loadOpenCv();
      const w = sourceCanvas.width;
      const h = sourceCanvas.height;
      const [tl, tr, br, bl] = corners.map((c) => ({ x: c.x * w, y: c.y * h }));

      // Output size follows the tapped quad's own proportions (the longer of
      // the two roughly-parallel edges each way) rather than an arbitrary
      // square, so the corrected image keeps sensible real-world proportions.
      const outW = Math.round(Math.max(Math.hypot(tr.x - tl.x, tr.y - tl.y), Math.hypot(br.x - bl.x, br.y - bl.y)));
      const outH = Math.round(Math.max(Math.hypot(bl.x - tl.x, bl.y - tl.y), Math.hypot(br.x - tr.x, br.y - tr.y)));

      const src = cv.imread(sourceCanvas);
      const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
      const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW, 0, outW, outH, 0, outH]);
      const transform = cv.getPerspectiveTransform(srcTri, dstTri);
      const warped = new cv.Mat();
      cv.warpPerspective(src, warped, transform, new cv.Size(outW, outH));

      const outCanvas = document.createElement("canvas");
      outCanvas.width = outW;
      outCanvas.height = outH;
      cv.imshow(outCanvas, warped);

      src.delete();
      warped.delete();
      transform.delete();
      srcTri.delete();
      dstTri.delete();

      onComplete(outCanvas);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="max-w-md text-center">
        <h3 className="text-lg font-medium">Straighten a tilted photo (optional)</h3>
        <p className="mt-1 text-sm text-gray-500">
          If this photo was taken at an angle, tap the plan&apos;s 4 corners in order — top-left, top-right, bottom-right,
          bottom-left — to straighten it before detection runs. Otherwise, skip this step.
        </p>
      </div>

      <div className="relative inline-block">
        {/* eslint-disable-next-line @next/next/no-img-element -- an in-memory canvas snapshot, never a persisted/optimizable remote image */}
        <img
          ref={imgRef}
          src={dataUrl}
          alt="Uploaded plan"
          onClick={handleClick}
          className="max-h-[420px] cursor-crosshair rounded-md border border-gray-300 dark:border-gray-700"
        />
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
          {corners.length > 1 && (
            <polyline points={corners.map((c) => `${c.x},${c.y}`).join(" ")} fill="none" stroke="#3b82f6" strokeWidth={0.004} />
          )}
          {corners.map((c, i) => (
            <circle key={i} cx={c.x} cy={c.y} r={0.012} fill="#3b82f6" stroke="#fff" strokeWidth={0.003} />
          ))}
        </svg>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => setCorners([])}
          disabled={corners.length === 0}
          className="rounded-md bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:hover:bg-gray-700"
        >
          Clear points
        </button>
        <button
          type="button"
          disabled={corners.length !== 4 || busy}
          onClick={applyWarp}
          className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900"
        >
          {busy ? "Straightening…" : "Straighten & continue"}
        </button>
        <button type="button" onClick={onSkip} className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:underline">
          Skip this step
        </button>
      </div>
    </div>
  );
}
