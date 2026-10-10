"use client";

// Every plan-image viewer (site plan, floor plan) renders its image inside an
// SVG using a normalized 0..1000 x 0..1000 viewBox (see MAP_VIEWBOX_SIZE), so
// traced polygon points are simple fractions of width/height. Without
// knowing the image's real aspect ratio, stretching it to fill a square box
// would distort it — this hook loads the image once client-side just to read
// its natural width/height, so the caller can size its container to match.
import { useEffect, useState } from "react";

// `known` is the image's stored pixel size (from the project row). With it the
// very first render already has the right shape; without it (older rows, or an
// unreadable file) the hook guesses 16:9 until the browser has loaded the image.
export function useImageAspectRatio(src: string | null | undefined, known?: { width?: number | null; height?: number | null }): number {
  const knownRatio = known?.width && known?.height ? known.width / known.height : null;
  const [ratio, setRatio] = useState(knownRatio ?? 16 / 9);

  useEffect(() => {
    // Stored size available: nothing to measure.
    if (knownRatio || !src) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setRatio(img.naturalWidth / img.naturalHeight);
      }
    };
    img.src = src;
  }, [src, knownRatio]);

  return knownRatio ?? ratio;
}
