"use client";

// "Fly to my plot": a short cinematic flight from the whole of India down to
// the buyer's own plot on the satellite photo, ending with the plot outlined
// and their family name on it. It uses the satellite alignment already saved
// for the project, so it only appears for projects that have been placed on the
// map. Loaded on demand (next/dynamic), so MapLibre is not downloaded for
// anyone who never taps it.
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Project, SatelliteAlignment, Unit } from "@/lib/types";
import { projectPoint, projectPolygon } from "@/lib/map/geo";
import { configureMaplibreWorker } from "@/lib/map/maplibreWorker";
import { ESRI_ATTRIBUTION, ESRI_TILE_URL } from "@/lib/satellite";

const INDIA: [number, number] = [78.9629, 22.5];
const FLIGHT_MS = 7000;

export function FlyToPlot({
  unit,
  project,
  alignment,
  onClose,
  onVisualise,
}: {
  unit: Unit;
  project: Project;
  alignment: SatelliteAlignment;
  onClose: () => void;
  onVisualise: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const labelRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<"loading" | "flying" | "arrived">("loading");
  const [name, setName] = useState("");
  const [run, setRun] = useState(0);
  const label = `${unit.wing ? `${unit.wing}-` : ""}${unit.unit_number}`;

  const geo = useMemo(() => {
    const ring = projectPolygon(unit.polygon_points, alignment);
    const lng = ring.reduce((s, p) => s + p.lng, 0) / ring.length;
    const lat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
    // The label sits just above the plot's back edge (top of the plan), so it
    // does not hide the outline.
    const pts = unit.polygon_points;
    const top = projectPoint({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: Math.min(...pts.map((p) => p.y)) }, alignment);
    return { ring, center: [lng, lat] as [number, number], top: [top.lng, top.lat] as [number, number] };
  }, [unit.polygon_points, alignment]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    import("maplibre-gl").then((mod) => {
      if (cancelled || !box.current) return;
      configureMaplibreWorker(mod);
      const map = new mod.Map({
        container: box.current,
        style: {
          version: 8,
          sources: { esri: { type: "raster", tiles: [ESRI_TILE_URL], tileSize: 256, maxzoom: 18, attribution: ESRI_ATTRIBUTION } },
          layers: [{ id: "esri", type: "raster", source: "esri" }],
        },
        center: INDIA,
        zoom: 3.6,
        pitch: 0,
        bearing: 0,
        interactive: true,
        attributionControl: false,
        fadeDuration: 200,
      });
      mapRef.current = map;

      // The padding keeps the plot in the part of the screen above the bottom panel.
      const target = { center: geo.center, zoom: 19.3, pitch: 52, bearing: alignment.northAngle, padding: { top: 70, bottom: 230, left: 0, right: 0 } };
      const arrive = () => {
        if (cancelled || map.getSource("plot")) return;
        const coords = [...geo.ring.map((p) => [p.lng, p.lat]), [geo.ring[0].lng, geo.ring[0].lat]];
        map.addSource("plot", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } } });
        map.addLayer({ id: "plot-fill", type: "fill", source: "plot", paint: { "fill-color": "#FF5A1F", "fill-opacity": 0.45 } });
        map.addLayer({ id: "plot-glow", type: "line", source: "plot", paint: { "line-color": "#FF5A1F", "line-width": 9, "line-blur": 5, "line-opacity": 0.7 } });
        map.addLayer({ id: "plot-line", type: "line", source: "plot", paint: { "line-color": "#ffffff", "line-width": 2.5 } });
        const el = document.createElement("div");
        el.className = "fly-label";
        labelRef.current = el;
        new mod.Marker({ element: el, anchor: "bottom" }).setLngLat(geo.top).addTo(map);
        paintLabel();
        setPhase("arrived");
      };
      map.once("load", () => {
        if (cancelled) return;
        if (reduce) {
          map.jumpTo(target);
          arrive();
          return;
        }
        setPhase("flying");
        map.flyTo({ ...target, duration: FLIGHT_MS, curve: 1.7, easing: (t: number) => 1 - Math.pow(1 - t, 3), essential: true });
        map.once("moveend", arrive);
      });
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      labelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new flight starts only when `run` changes
  }, [run]);

  function paintLabel() {
    const el = labelRef.current;
    if (!el) return;
    el.innerHTML = "";
    const a = document.createElement("div");
    a.textContent = `PLOT ${label}`;
    el.appendChild(a);
    const n = name.trim();
    if (n) {
      const b = document.createElement("div");
      b.textContent = `${n} Residence`;
      b.className = "fly-name";
      el.appendChild(b);
    }
  }
  useEffect(paintLabel, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  function skip() {
    const map = mapRef.current;
    if (!map) return;
    map.stop();
    map.jumpTo({ center: geo.center, zoom: 19.3, pitch: 52, bearing: alignment.northAngle, padding: { top: 70, bottom: 230, left: 0, right: 0 } });
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Flight to plot ${label}`} className="theme-survey fixed inset-0 z-[3000] bg-black text-[var(--ink)]">
      <style>{`.fly-label{background:#0F2A3D;color:#fff;border:2px solid #FF5A1F;padding:5px 9px;font:600 12px var(--font-plex-mono),monospace;letter-spacing:.08em;text-align:center;box-shadow:3px 3px 0 rgba(0,0,0,.45);margin-bottom:8px}.fly-name{margin-top:2px;font:600 11px system-ui,sans-serif;letter-spacing:0;color:#FFD9C7}`}</style>
      {/* maplibre-gl.css makes its container position: relative, which would collapse an
          absolutely positioned one to zero height, so the map fills a sized wrapper instead */}
      <div className="absolute inset-0">
        <div ref={box} className="h-full w-full" />
      </div>
      {/* swallow touches during the flight so a stray tap cannot stop it halfway */}
      {phase !== "arrived" && <div className="absolute inset-0" />}
      {/* Esri's terms require this credit on every map that uses their tiles */}
      <p className="pointer-events-none absolute left-3 top-[68px] max-w-[70%] bg-black/55 px-1.5 py-0.5 text-[9px] leading-snug text-white/85">{ESRI_ATTRIBUTION}</p>

      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-4 pb-6 pt-3">
        <button type="button" onClick={onClose} className="flex min-h-11 items-center gap-2 border-2 border-white/80 bg-black/55 px-3 font-label text-[12px] font-semibold uppercase tracking-[0.1em] text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)]">
          <span aria-hidden>←</span> Back
        </button>
        <span className="border border-white/50 bg-black/55 px-2.5 py-1.5 font-label text-[11px] uppercase tracking-[0.12em] text-white" aria-live="polite">
          {phase === "arrived" ? `Plot ${label} · arrived` : `Flying to plot ${label}`}
        </span>
      </div>

      {phase !== "arrived" && (
        <div className="absolute inset-x-0 bottom-0 flex justify-center px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <button type="button" onClick={skip} disabled={phase === "loading"} className="min-h-11 border-2 border-white/80 bg-black/55 px-4 font-label text-[12px] font-semibold uppercase tracking-[0.1em] text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)]">
            {phase === "loading" ? "Loading the map…" : "Skip the flight"}
          </button>
        </div>
      )}

      {phase === "arrived" && (
        <div className="absolute inset-x-0 bottom-0 border-t-2 border-[var(--ink)] bg-[var(--paper)] px-4 pb-[calc(0.9rem+env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto max-w-xl">
            <p className="font-label text-[11px] uppercase tracking-[0.1em] text-[var(--ink-3)]">{project.name} · this is your plot</p>
            <label htmlFor="fly-name" className="mt-2 block text-[14px]">Put your family name on it</label>
            <input
              id="fly-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 24))}
              placeholder="Your family name"
              autoComplete="off"
              className="mt-1 w-full border-2 border-[var(--ink)] bg-white px-3 py-2.5 text-[15px] placeholder:text-[var(--ink-3)]/70 focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)]"
            />
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => { setPhase("loading"); setRun((r) => r + 1); }} className="flex min-h-12 flex-1 items-center justify-center border-2 border-[var(--ink)] bg-white font-label text-[12px] font-semibold uppercase tracking-[0.08em] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)]">
                Fly again
              </button>
              <button type="button" onClick={onVisualise} className="flex min-h-12 flex-[2] items-center justify-between bg-[var(--accent)] px-4 font-label text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--accent-ink)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--signal)]">
                Imagine your home here <span aria-hidden className="text-[var(--signal)]">→</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
