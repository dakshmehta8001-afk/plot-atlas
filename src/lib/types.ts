// Hand-written types mirroring the Postgres schema in
// supabase/migrations/20260918100000_init_schema.sql. Every component and
// Server Action imports its shapes from here so the whole app agrees on one
// definition — if the schema changes, update both together.

export type Role = "admin" | "sub_admin" | "viewer";
export type UserStatus = "pending" | "active" | "rejected";

export interface AppUser {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  role: Role;
  status: UserStatus;
  created_at: string;
}

// A lat/lng rectangle the project's plan image is aligned to on a satellite
// map (see lib/geo.ts). Null until the sub-admin runs the satellite
// alignment step in the dashboard.
export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export type ProjectStatus = "draft" | "published";

export interface Project {
  id: string;
  sub_admin_id: string;
  name: string;
  slug: string;
  location: string | null;
  description: string | null;
  developer_name: string | null;
  plan_image_url: string | null;
  map_bounds: MapBounds | null;
  status: ProjectStatus;
  // The developer's own published business contact info (opt-in, shown as
  // quick-contact icons on a unit's info card) — not the same thing as a
  // user's private email/phone, which RLS keeps unreadable to the public.
  contact_phone: string | null;
  contact_whatsapp: string | null;
  contact_email: string | null;
  created_at: string;
}

// A single traced point, stored as a fraction (0..1) of the relevant plan
// image's width/height — NOT raw pixels. This is deliberate: it means the
// tracer and every viewer only ever need to agree on which IMAGE a shape
// was traced on, never on that image's real pixel dimensions. A building's
// footprint is traced this way against the project's master plan image; a
// flat's outline is traced the same way but against its own floor's plan
// image instead. Both render into the same normalized 0..1000 SVG viewBox
// (see MAP_VIEWBOX_SIZE) with preserveAspectRatio="none", and
// useImageAspectRatio sizes the container to the real image so nothing gets
// stretched.
export interface PolygonPoint {
  x: number;
  y: number;
}

export const MAP_VIEWBOX_SIZE = 1000;

// Common road widths a sub-admin picks from when tracing a road, per the
// user's spec — a road that doesn't match one of these still works, since
// width_label is free text; this list is just what the picker offers first.
export const ROAD_WIDTH_PRESETS = ["30 ft", "40 ft", "60 ft", "100 ft", "150 ft", "200 ft"];

export interface Road {
  id: string;
  project_id: string;
  width_label: string;
  path_points: PolygonPoint[];
  created_at: string;
}

export interface Building {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  total_floors: number | null;
  polygon_points: PolygonPoint[];
  created_at: string;
}

export interface Floor {
  id: string;
  building_id: string;
  floor_number: number;
  name: string | null;
  plan_image_url: string | null;
  created_at: string;
}

export type UnitKind = "plot" | "flat";
export type UnitStatus = "available" | "hold" | "sold" | "booked";

// A single row covers both a standalone land plot (building_id/floor_id
// null, traced on the project's master plan) and a flat inside a building
// (floor_id set, traced on that floor's own plan image). Sharing one table
// means status/category coloring, RLS, and the enquiry flow are identical
// for both kinds instead of duplicated across two schemas.
export interface Unit {
  id: string;
  project_id: string;
  building_id: string | null;
  floor_id: string | null;
  unit_type: UnitKind;
  unit_number: string;
  wing: string | null;
  bhk_type: string | null;
  category: string | null;
  status: UnitStatus;
  facing: string | null;
  dimensions: string | null;
  area_sqft: number | null;
  carpet_area_sqft: number | null;
  rate_per_sqft: number | null;
  total_price: number | null;
  polygon_points: PolygonPoint[];
  created_at: string;
}

export type MediaType = "image" | "video";

export interface ProjectMedia {
  id: string;
  project_id: string;
  media_url: string;
  media_type: MediaType;
  caption: string | null;
  sort_order: number;
  created_at: string;
}

export type LeadStatus = "new" | "contacted" | "visit_scheduled" | "converted" | "closed";

export interface Lead {
  id: string;
  project_id: string;
  unit_id: string | null;
  viewer_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  message: string | null;
  status: LeadStatus;
  created_at: string;
}

export type SiteVisitStatus = "scheduled" | "completed" | "cancelled" | "no_show";

export interface SiteVisit {
  id: string;
  lead_id: string;
  scheduled_at: string | null;
  status: SiteVisitStatus;
  notes: string | null;
  created_at: string;
}

// Color/label lookup shared by every place a unit's sale status is
// rendered (map overlays, info cards, dashboard tables) so they can never
// drift out of sync with each other.
export const UNIT_STATUS_STYLES: Record<UnitStatus, { label: string; fill: string; border: string }> = {
  available: { label: "Available", fill: "rgba(34,197,94,0.35)", border: "#16a34a" },
  hold: { label: "On hold", fill: "rgba(234,179,8,0.35)", border: "#ca8a04" },
  booked: { label: "Booked", fill: "rgba(59,130,246,0.35)", border: "#2563eb" },
  sold: { label: "Sold", fill: "rgba(239,68,68,0.35)", border: "#dc2626" },
};

export const UNIT_STATUS_OPTIONS: UnitStatus[] = ["available", "hold", "booked", "sold"];
export const LEAD_STATUS_OPTIONS: LeadStatus[] = ["new", "contacted", "visit_scheduled", "converted", "closed"];
export const SITE_VISIT_STATUS_OPTIONS: SiteVisitStatus[] = ["scheduled", "completed", "cancelled", "no_show"];

// "Zone colours" legend (MapBhoomi-style): each unit's free-text `category`
// doubles as its zone tag (e.g. "Corner Plot", "Premium Plots"). Colors are
// assigned by a zone's position in the project's sorted list of distinct
// zone names, cycling through this palette, so the same zone name always
// gets the same color within one project without a dedicated color column.
const ZONE_COLOR_PALETTE = [
  "#3b82f6", // blue
  "#eab308", // yellow
  "#22c55e", // green
  "#ec4899", // pink
  "#a855f7", // purple
  "#f97316", // orange
  "#06b6d4", // cyan
  "#f43f5e", // rose
];

export function zoneColorFor(zone: string, allZonesSorted: string[]): string {
  const index = allZonesSorted.indexOf(zone);
  return ZONE_COLOR_PALETTE[index % ZONE_COLOR_PALETTE.length] ?? ZONE_COLOR_PALETTE[0];
}

export function distinctZones(units: Pick<Unit, "category">[]): string[] {
  return Array.from(new Set(units.map((u) => u.category).filter((c): c is string => !!c))).sort();
}

// Non-sellable amenities/landmarks a site plan often shows alongside plots
// and roads — traced the same way as a building footprint (closed polygon
// on the master plan image), but with no sale status of their own.
export type SiteFeatureKind =
  | "park"
  | "temple"
  | "gate"
  | "clubhouse"
  | "common_area"
  | "water_body"
  | "other";

export interface SiteFeature {
  id: string;
  project_id: string;
  kind: SiteFeatureKind;
  label: string;
  polygon_points: PolygonPoint[];
  created_at: string;
}

export const SITE_FEATURE_STYLES: Record<SiteFeatureKind, { label: string; fill: string; border: string }> = {
  park: { label: "Park", fill: "rgba(34,197,94,0.25)", border: "#15803d" },
  temple: { label: "Temple", fill: "rgba(249,115,22,0.3)", border: "#c2410c" },
  gate: { label: "Gate", fill: "rgba(100,116,139,0.35)", border: "#334155" },
  clubhouse: { label: "Clubhouse", fill: "rgba(168,85,247,0.3)", border: "#7e22ce" },
  common_area: { label: "Common area", fill: "rgba(20,184,166,0.25)", border: "#0f766e" },
  water_body: { label: "Water body", fill: "rgba(59,130,246,0.3)", border: "#1d4ed8" },
  other: { label: "Other", fill: "rgba(148,163,184,0.3)", border: "#475569" },
};

export const SITE_FEATURE_KIND_OPTIONS: SiteFeatureKind[] = [
  "park",
  "temple",
  "gate",
  "clubhouse",
  "common_area",
  "water_body",
  "other",
];

// Human-friendly ordering for a floor list: Ground first, then ascending.
export function sortFloors(floors: Floor[]): Floor[] {
  return [...floors].sort((a, b) => a.floor_number - b.floor_number);
}

export function floorLabel(floor: Floor): string {
  if (floor.name) return floor.name;
  return floor.floor_number === 0 ? "Ground Floor" : `Floor ${floor.floor_number}`;
}
