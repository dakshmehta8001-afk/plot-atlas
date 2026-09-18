"use client";

// Every plan-image viewer (site plan, floor plan) renders its image inside an
// SVG using a normalized 0..1000 x 0..1000 viewBox (see MAP_VIEWBOX_SIZE), so
// traced polygon points are simple fractions of width/height. Without
// knowing the image's real aspect ratio, stretching it to fill a square box
// would distort it — this hook loads the image once client-side just to read
// its natural width/height, so the caller can size its container to match.
import { useEffect, useState } from "react";

export function useImageAspectRatio(src: string | null | undefined): number {
  const [ratio, setRatio] = useState(16 / 9);

  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setRatio(img.naturalWidth / img.naturalHeight);
      }
    };
    img.src = src;
  }, [src]);

  return ratio;
}
