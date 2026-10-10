"use client";

// Animates a displayed integer from its previous value up (or down) to a
// new target whenever that target changes — used by ProjectMapClient's
// Total/Available/Hold/Booked/Sold stat chips so they count up on first
// load instead of just appearing as static numbers.
//
// Driven by requestAnimationFrame, not a CSS transition, since there's no
// CSS property that interpolates the TEXT CONTENT of a number — this is
// exactly the kind of animation the global `prefers-reduced-motion` CSS
// override (see globals.css) can't reach, since that only neuters CSS
// animations/transitions. Checked directly here instead.
import { useEffect, useState } from "react";

const DURATION_MS = 700;

// A gentle deceleration curve (matches the app's --ease-cinematic
// character) rather than a linear count, so the animation settles into the
// final number instead of stopping abruptly.
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Starts at 0 (not `target`) specifically so the very first render already
// differs from the target — that's what makes the initial mount count up
// from zero, rather than needing a separate "is this the first render"
// branch just to kick off that one case.
export function useCountUp(target: number): number {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (display === target) return;

    // Reduced motion collapses to a duration of 0 rather than a separate
    // early-return branch that calls setState directly in the effect body
    // (a real issue caught by eslint's react-hooks/set-state-in-effect: a
    // direct, unconditional setState on every effect run can cause a
    // cascading extra render) — the single tick() callback below still
    // handles it, just resolving to the target on its first frame, and its
    // setState call is inside an async rAF callback, not the effect body
    // itself.
    const reduceMotion =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const duration = reduceMotion ? 0 : DURATION_MS;
    const from = display;
    const start = performance.now();
    let rafId: number;
    function tick(now: number) {
      const t = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
      setDisplay(Math.round(from + (target - from) * easeOutCubic(t)));
      if (t < 1) rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed only on target; `display` is read once per animation start (as the "from" value), not tracked as a trigger
  }, [target]);

  return display;
}
