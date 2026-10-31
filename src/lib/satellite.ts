// Single source of truth for satellite imagery config.
// All satellite-related components import from here so the URL and credit
// never drift out of sync.

// Esri World Imagery tile URL. The {z}/{y}/{x} template is the MapLibre
// convention (NOT the TMS convention which uses {z}/{x}/{y}).
export const ESRI_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

// Must appear on every map that uses these tiles — Esri's terms require it.
export const ESRI_ATTRIBUTION =
  "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";
