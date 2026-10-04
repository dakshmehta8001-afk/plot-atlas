"use client";

// Cars and walkers on the public site map. ONE requestAnimationFrame loop
// steps the simulation in lib/mapTraffic.ts and writes each agent's position
// straight to its SVG element (setAttribute on a ref) — never React state, so
// moving traffic causes no React re-renders at all.
//
// The loop only runs while it is useful:
//  - not while the browser tab is hidden,
//  - not while the map is scrolled off screen,
//  - never under prefers-reduced-motion (everything stays still, parked at
//    its starting spot).
// It never skips frames. If frames run slow it removes a car (then a walker)
// instead, so a weak phone still gets a smooth map with less traffic.
import { memo, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { activeCars, createSim, removeOneCar, removeOneWalker, stepSim, type Network, type Pose } from "@/lib/mapTraffic";

const CAR_COLORS = ["#d7473f", "#f4f4f2", "#2f6fb5", "#b8bcc4", "#1f2933", "#e0a526"];
const BIKE_COLORS = ["#e11d48", "#2563eb", "#16a34a", "#f59e0b", "#6b7280"];
const WALKER_COLORS = ["#e2553f", "#3f7fd9", "#f2c14e", "#7a5bd6", "#3aa57a"];

// Average frame time (seconds) above which one car is removed, and how long
// to wait between removals so the average can recover.
const SLOW_FRAME_SECONDS = 0.028;
const SLOW_CHECK_SECONDS = 2;
const MIN_CARS = 3;

function transformOf(p: Pose): string {
  return `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.angle.toFixed(1)}) scale(${p.scale.toFixed(3)})`;
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReduced(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const reducedNow = () => window.matchMedia(REDUCED_QUERY).matches;
const reducedOnServer = () => false;

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const MapTraffic = memo(function MapTraffic({ network, seedKey }: { network: Network; seedKey: string }) {
  const seed = useMemo(() => hashString(seedKey), [seedKey]);
  // Starting positions, drawn on first render (and on the server) so the map
  // is never empty. The loop below runs its own copy of the same simulation.
  const start = useMemo(() => createSim(network, { seed }), [network, seed]);
  const reduced = useSyncExternalStore(subscribeReduced, reducedNow, reducedOnServer);
  const groupRef = useRef<SVGGElement>(null);
  const carEls = useRef<(SVGGElement | null)[]>([]);
  const walkerEls = useRef<(SVGGElement | null)[]>([]);

  useEffect(() => {
    if (reduced) return; // frozen: cars and walkers stay parked at their starting spots
    const group = groupRef.current;
    if (!group) return;
    const sim = createSim(network, { seed });
    const svg = group.ownerSVGElement;

    let raf = 0;
    let last = 0;
    let running = false;
    let onScreen = true;
    let tabVisible = !document.hidden;
    let avg = 1 / 60;
    let sinceCheck = 0;

    const apply = () => {
      for (const c of sim.cars) {
        const el = carEls.current[c.id];
        if (!el) continue;
        if (!c.active) {
          if (el.style.display !== "none") el.style.display = "none";
          continue;
        }
        el.setAttribute("transform", transformOf(c));
      }
      for (const w of sim.walkers) {
        const el = walkerEls.current[w.id];
        if (!el) continue;
        if (!w.active) {
          if (el.style.display !== "none") el.style.display = "none";
          continue;
        }
        el.setAttribute("transform", transformOf(w));
      }
    };

    const frame = (now: number) => {
      if (!running) return;
      const raw = (now - last) / 1000;
      last = now;
      // The simulation clamps big gaps itself (so a returning tab can't make
      // things jump); the slow-frame check uses the real frame time.
      stepSim(sim, raw);
      apply();

      avg = avg * 0.9 + Math.min(raw, 0.2) * 0.1;
      sinceCheck += raw;
      if (sinceCheck >= SLOW_CHECK_SECONDS) {
        sinceCheck = 0;
        if (avg > SLOW_FRAME_SECONDS) {
          if (activeCars(sim) > MIN_CARS) removeOneCar(sim);
          else removeOneWalker(sim);
        }
      }
      raf = requestAnimationFrame(frame);
    };

    const update = () => {
      const should = onScreen && tabVisible;
      if (should && !running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(frame);
      } else if (!should && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    };

    const onVisibility = () => {
      tabVisible = !document.hidden;
      update();
    };
    document.addEventListener("visibilitychange", onVisibility);

    let observer: IntersectionObserver | null = null;
    if (svg && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        onScreen = entries.some((e) => e.isIntersecting);
        update();
      });
      observer.observe(svg);
    }
    update();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
    };
  }, [network, seed, reduced]);

  return (
    <g ref={groupRef} className="pointer-events-none">
      {start.cars.map((c) => (
        <g
          key={`car-${c.id}`}
          ref={(el) => {
            carEls.current[c.id] = el;
          }}
          transform={transformOf(c)}
        >
          <use href={c.kind === "bike" ? "#sp-bike" : "#sp-car"} color={(c.kind === "bike" ? BIKE_COLORS : CAR_COLORS)[c.id % (c.kind === "bike" ? BIKE_COLORS : CAR_COLORS).length]} />
        </g>
      ))}
      {start.walkers.map((w) => (
        <g
          key={`walker-${w.id}`}
          ref={(el) => {
            walkerEls.current[w.id] = el;
          }}
          transform={transformOf(w)}
        >
          <use href="#sp-walker" color={WALKER_COLORS[w.id % WALKER_COLORS.length]} />
        </g>
      ))}
    </g>
  );
});
