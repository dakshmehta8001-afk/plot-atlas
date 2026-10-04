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
import { activeCars, buildWalkGraph, createSim, removeOneCar, stepSim, WALKER_BASE_WIDTH, type Network, type Pose } from "@/lib/mapTraffic";
import { WalkerSim, type WalkerPose } from "@/lib/mapWalkers";

const CAR_COLORS = ["#d7473f", "#f4f4f2", "#2f6fb5", "#b8bcc4", "#1f2933", "#e0a526"];
const BIKE_COLORS = ["#e11d48", "#2563eb", "#16a34a", "#f59e0b", "#6b7280"];
const WALKER_COLORS = ["#e2553f", "#3f7fd9", "#f2c14e", "#7a5bd6", "#3aa57a"];

// Average frame time (seconds) above which one car is removed, and how long
// to wait between removals so the average can recover.
const SLOW_FRAME_SECONDS = 0.028;
const SLOW_CHECK_SECONDS = 2;
const MIN_CARS = 3;
// A walker is never drawn smaller than this on screen (its shoulder span, in
// pixels), so people stay visible when the whole site is fitted on a phone.
const MIN_WALKER_PX = 12;
const MIN_WALKERS = 1;

// One walker for every two roads, as before.
function walkerCountFor(net: Network): number {
  return Math.floor(new Set(net.edges.map((e) => e.roadId)).size / 2);
}

// Builds a walker sim wired to the car sim: walkers wait while a car holds
// the junction they want to cross, and cars wait while a walker is crossing.
function makeWalkers(net: Network, seed: number, count: number, cars: ReturnType<typeof createSim> | null): WalkerSim {
  const g = buildWalkGraph(net);
  const walkers = new WalkerSim(g.nodes, g.edges, {
    count,
    seed,
    spriteWidth: WALKER_BASE_WIDTH,
    pavementRatio: 0.1,
    // Junction node ids are the traffic node ids as text (see buildWalkGraph);
    // bend points along a curved road are not in the lock table, so they are never "busy".
    isJunctionBusy: (id) => (cars ? cars.locks[Number(id)]?.holder != null : false),
  });
  if (cars) cars.pedCrossing = (nodeId) => walkers.isCrossing(String(nodeId));
  return walkers;
}

function transformOf(p: Pose | WalkerPose, minScale = 0): string {
  return `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.angle.toFixed(1)}) scale(${Math.max(p.scale, minScale).toFixed(3)})`;
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
  const startWalkers = useMemo(() => makeWalkers(network, seed, walkerCountFor(network), null).poses, [network, seed]);
  const reduced = useSyncExternalStore(subscribeReduced, reducedNow, reducedOnServer);
  const groupRef = useRef<SVGGElement>(null);
  const carEls = useRef<(SVGGElement | null)[]>([]);
  const walkerEls = useRef<(SVGGElement | null)[]>([]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    if (reduced) {
      // Frozen: cars and walkers stay parked at their starting spots. The
      // walkers are still drawn at least MIN_WALKER_PX wide, once, using the
      // current zoom (so they are not left tiny on a phone).
      const id = requestAnimationFrame(() => {
        const k = Number(group.ownerSVGElement?.style.getPropertyValue("--k")) || 0.4;
        startWalkers.forEach((w, i) => walkerEls.current[i]?.setAttribute("transform", transformOf(w, MIN_WALKER_PX / (WALKER_BASE_WIDTH * k))));
      });
      return () => cancelAnimationFrame(id);
    }
    const sim = createSim(network, { seed });
    let walkerCount = walkerCountFor(network);
    let walkers = makeWalkers(network, seed, walkerCount, sim);
    const svg = group.ownerSVGElement;
    // Screen pixels per map unit (the viewer keeps this up to date as --k).
    const minWalkerScale = () => MIN_WALKER_PX / (WALKER_BASE_WIDTH * (Number(svg?.style.getPropertyValue("--k")) || 0.4));

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
      const minScale = minWalkerScale();
      const poses = walkers.poses;
      for (let i = 0; i < poses.length; i++) {
        const el = walkerEls.current[i];
        if (el) el.setAttribute("transform", transformOf(poses[i], minScale));
      }
      // Hide the elements of walkers removed for speed.
      for (let i = poses.length; i < walkerEls.current.length; i++) {
        const el = walkerEls.current[i];
        if (el && el.style.display !== "none") el.style.display = "none";
      }
    };

    const frame = (now: number) => {
      if (!running) return;
      const raw = (now - last) / 1000;
      last = now;
      // The simulation clamps big gaps itself (so a returning tab can't make
      // things jump); the slow-frame check uses the real frame time.
      walkers.step(Math.min(0.05, raw));
      stepSim(sim, raw);
      apply();

      avg = avg * 0.9 + Math.min(raw, 0.2) * 0.1;
      sinceCheck += raw;
      if (sinceCheck >= SLOW_CHECK_SECONDS) {
        sinceCheck = 0;
        if (avg > SLOW_FRAME_SECONDS) {
          if (activeCars(sim) > MIN_CARS) removeOneCar(sim);
          else if (walkerCount > MIN_WALKERS) {
            // The walker sim cannot drop one in place, so start it again with one fewer.
            walkerCount--;
            walkers = makeWalkers(network, seed, walkerCount, sim);
          }
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
  }, [network, seed, reduced, startWalkers]);

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
      {startWalkers.map((w, i) => (
        <g
          key={`walker-${i}`}
          ref={(el) => {
            walkerEls.current[i] = el;
          }}
          transform={transformOf(w, 0.35)}
        >
          <use href="#sp-walker" color={WALKER_COLORS[i % WALKER_COLORS.length]} />
        </g>
      ))}
    </g>
  );
});
