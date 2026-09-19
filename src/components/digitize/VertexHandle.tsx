"use client";

// A single draggable point on a selected shape's boundary. Nothing in the
// existing tracer/viewer stack drags a point once placed (PolygonTracer is
// append-only), so this establishes that interaction fresh — see
// svgCoords.ts for how a drag's screen position is converted back into the
// canvas's own fractional coordinate space regardless of the review
// canvas's current pan/zoom.
import { MAP_VIEWBOX_SIZE } from "@/lib/types";
import { clientPointToLocalFraction } from "./svgCoords";

const VB = MAP_VIEWBOX_SIZE;

export function VertexHandle({
  x,
  y,
  onDrag,
  onDoubleClick,
}: {
  x: number;
  y: number;
  onDrag: (next: { x: number; y: number }) => void;
  /** Double-clicking a vertex removes it (see ShapeLayer's minimum-point guard). */
  onDoubleClick: () => void;
}) {
  function handlePointerDown(event: React.PointerEvent<SVGCircleElement>) {
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    function handleMove(moveEvent: PointerEvent) {
      const local = clientPointToLocalFraction(target, moveEvent.clientX, moveEvent.clientY, VB);
      if (local) onDrag(local);
    }
    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  return (
    <g>
      {/* Enlarged invisible hit-area — a handle actually sized to look right
          at this viewBox's scale (1000 units) is much too small to reliably
          grab with a mouse, let alone a finger. */}
      <circle
        cx={x * VB}
        cy={y * VB}
        r={VB * 0.02}
        fill="transparent"
        onPointerDown={handlePointerDown}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDoubleClick();
        }}
        className="cursor-move"
      />
      <circle
        cx={x * VB}
        cy={y * VB}
        r={VB * 0.006}
        fill="#f59e0b"
        stroke="#1f2937"
        strokeWidth={VB * 0.0015}
        className="pointer-events-none"
      />
    </g>
  );
}
