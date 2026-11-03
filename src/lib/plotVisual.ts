// Pure calculations for the "Visualise your home" view. No React or DOM, so it
// can be tested in node. Everything is in feet. The plot is drawn as a simple
// rectangle (frontage x depth) with the road along the front; the real traced
// shape can differ slightly. Local building rules (setbacks, coverage, height)
// decide what can really be built, so these numbers are a picture, not advice.
import type { Unit } from "@/lib/types";

export type Facing = "north" | "east" | "south" | "west";

export interface PlotSize {
  /** The side along the road, in feet. */
  frontage: number;
  /** How far the plot goes back from the road, in feet. */
  depth: number;
  /** Plot area in square feet (the saved area when there is one). */
  area: number;
}

/**
 * Reads the plot's size from its saved dimensions ("30' x 50'", "30*50",
 * "50 x 30"), falling back to its saved area. The shorter side is taken as
 * the frontage, which matches how this layout is drawn (30 ft or 40 ft on the
 * road, 50 ft deep).
 */
export function parsePlotSize(unit: Pick<Unit, "dimensions" | "area_sqft">): PlotSize | null {
  const nums = (unit.dimensions ?? "").match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const saved = typeof unit.area_sqft === "number" && isFinite(unit.area_sqft) && unit.area_sqft > 0 ? unit.area_sqft : null;
  if (nums.length >= 2 && nums[0] > 0 && nums[1] > 0) {
    const frontage = Math.min(nums[0], nums[1]);
    const depth = Math.max(nums[0], nums[1]);
    return { frontage, depth, area: saved ?? Math.round(frontage * depth) };
  }
  if (saved) {
    const frontage = Math.round(Math.sqrt((saved * 3) / 5));
    return { frontage, depth: Math.round(saved / frontage), area: saved };
  }
  return null;
}

/** Square yards ("gaj"), the unit many Indian buyers use for plots. */
export function toGaj(sqft: number): number {
  return sqft / 9;
}

export function normaliseFacing(value: string | null | undefined): Facing | null {
  const v = (value ?? "").trim().toLowerCase();
  return v === "north" || v === "east" || v === "south" || v === "west" ? v : null;
}

/**
 * Rotation (degrees, clockwise on screen) that turns a north-up map so the
 * plot's facing points down, toward the road drawn at the bottom. Used to
 * place the compass and the Vastu zones.
 */
export function rotationForFacing(f: Facing): number {
  return f === "south" ? 0 : f === "north" ? 180 : f === "east" ? 90 : -90;
}

export interface HomeLayout {
  /** House width across the plot. */
  houseW: number;
  /** House depth (front to back). */
  houseD: number;
  /** Footprint actually used, which can be smaller than asked if it does not fit. */
  footprint: number;
  /** The most that fits with the side, rear and front gaps left clear. */
  maxFootprint: number;
  /** Top of the house, measured from the back of the plot. */
  houseTop: number;
  /** Open depth between the front of the house and the road side boundary. */
  front: number;
  cols: number;
  rows: number;
  /** Cars that fit nose-in across the front yard. */
  cars: number;
  openLand: number;
}

export const SIDE_GAP = 4;
export const REAR_GAP = 4;
export const MIN_FRONT = 10;
export const CAR_W = 7;
export const CAR_L = 16;

export function homeLayout(plot: PlotSize, wantedFootprint: number): HomeLayout {
  const houseW = Math.max(8, plot.frontage - 2 * SIDE_GAP);
  const maxDepth = Math.max(0, plot.depth - REAR_GAP - MIN_FRONT);
  const maxFootprint = Math.floor((houseW * maxDepth) / 50) * 50;
  const footprint = Math.max(0, Math.min(wantedFootprint, maxFootprint));
  const houseD = footprint / houseW;
  const front = plot.depth - REAR_GAP - houseD;
  const cols = Math.max(0, Math.floor((plot.frontage - 2) / (CAR_W + 0.5)));
  const rows = Math.max(0, Math.floor(front / (CAR_L + 1)));
  return {
    houseW,
    houseD,
    footprint,
    maxFootprint,
    houseTop: REAR_GAP,
    front,
    cols,
    rows,
    cars: cols * rows,
    openLand: Math.max(0, Math.round(plot.frontage * plot.depth - footprint)),
  };
}

/**
 * A sensible first footprint: under half the plot, and small enough to leave
 * one row of cars in front. Steps of 50 sq ft.
 */
export function defaultFootprint(plot: PlotSize): number {
  const houseW = Math.max(8, plot.frontage - 2 * SIDE_GAP);
  const leaveForCars = houseW * Math.max(0, plot.depth - REAR_GAP - (CAR_L + 2));
  const want = Math.min(plot.frontage * plot.depth * 0.45, leaveForCars);
  return Math.max(0, Math.round(want / 50) * 50);
}

export function floorsLabel(upperFloors: number): string {
  return upperFloors <= 0 ? "Ground floor" : `G+${upperFloors}`;
}

export const VASTU_ZONES = [
  { corner: "NE", vec: [1, -1], text: "Pooja, water" },
  { corner: "SE", vec: [1, 1], text: "Kitchen" },
  { corner: "SW", vec: [-1, 1], text: "Bedroom" },
  { corner: "NW", vec: [-1, -1], text: "Guest, garage" },
] as const;

/**
 * Where each compass corner sits on the plot once the map is turned so the
 * plot faces the road at the bottom. Returns "left" or "right" and "top" or
 * "bottom" for each corner.
 */
export function vastuPlacement(f: Facing): { corner: string; text: string; h: "left" | "right"; v: "top" | "bottom" }[] {
  const th = (rotationForFacing(f) * Math.PI) / 180;
  const c = Math.cos(th), s = Math.sin(th);
  return VASTU_ZONES.map((z) => {
    const x = z.vec[0] * c - z.vec[1] * s;
    const y = z.vec[0] * s + z.vec[1] * c;
    return { corner: z.corner, text: z.text, h: x > 0 ? "right" : "left", v: y > 0 ? "bottom" : "top" };
  });
}
