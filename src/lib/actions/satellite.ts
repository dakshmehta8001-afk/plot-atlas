"use server";

// Resolves a Google Maps URL (including short links like maps.app.goo.gl or
// goo.gl/maps/…) to a lat/lng pair by following redirects server-side and
// parsing the canonical URL. Returns null if no coordinates can be extracted.
//
// Must run on the server (not in the browser) because:
//   1. Short-link resolution crosses origins — the server avoids CORS.
//   2. The final googleapis.com URL embeds the coordinates, so the browser
//      never needs to receive the raw HTTP redirect chain.

export async function resolveGoogleMapsCoords(
  rawUrl: string,
): Promise<{ lat: number; lng: number } | null> {
  let url = rawUrl.trim();

  // Try to follow redirects (handles maps.app.goo.gl and goo.gl/maps/…)
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        // Some Google endpoints return a richer redirect chain with a browser UA.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      // Only follow the redirect chain — we don't need the body.
      signal: AbortSignal.timeout(5000),
    });
    url = res.url;
  } catch {
    // Network error or timeout — fall through and try parsing the original URL.
  }

  return extractLatLng(url);
}

// Extract lat/lng from any Google Maps canonical URL format:
//   https://www.google.com/maps/place/Name/@lat,lng,zoom
//   https://www.google.com/maps/@lat,lng,zoom
//   https://www.google.com/maps?q=lat,lng
//   https://maps.google.com/?ll=lat,lng
function extractLatLng(url: string): { lat: number; lng: number } | null {
  // @lat,lng (all place/@ formats) — must come before the ?q= check
  const atMatch = url.match(/@(-?\d+\.?\d+),(-?\d+\.?\d+)/);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lng = parseFloat(atMatch[2]);
    if (isValid(lat, lng)) return { lat, lng };
  }

  // ?q=lat,lng or ?q=lat%2Clng
  const qMatch = url.match(/[?&]q=(-?\d+\.?\d+)[,%2C]+(-?\d+\.?\d+)/i);
  if (qMatch) {
    const lat = parseFloat(qMatch[1]);
    const lng = parseFloat(qMatch[2]);
    if (isValid(lat, lng)) return { lat, lng };
  }

  // ?ll=lat,lng
  const llMatch = url.match(/[?&]ll=(-?\d+\.?\d+),(-?\d+\.?\d+)/);
  if (llMatch) {
    const lat = parseFloat(llMatch[1]);
    const lng = parseFloat(llMatch[2]);
    if (isValid(lat, lng)) return { lat, lng };
  }

  return null;
}

function isValid(lat: number, lng: number): boolean {
  return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
