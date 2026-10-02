// Labels each detected shape by OCR-ing a small CROP of its own interior —
// not by running one OCR pass over the whole plan image. That's the fix for
// a real bug found via extensive isolated testing (see ocrWorker.ts's doc
// comment for the full story): a whole-image pass, at any page-segmentation
// mode tried, consistently misread every plot number as short garbage.
// Cropping to just one shape's interior (inset inward to stay clear of its
// own boundary stroke) and reading it with PSM.SINGLE_BLOCK reads correctly
// at 90%+ confidence — confirmed empirically, not assumed.
import type { PolygonPoint, SiteFeatureKind } from "@/lib/types";
import { recognizeCrop, recognizeCropWords, type OcrCropResult } from "../ocrWorker";
import type { DetectedShape } from "../types";

const FEATURE_KEYWORDS: { pattern: RegExp; kind: SiteFeatureKind; label: string }[] = [
  { pattern: /\bpark\b/i, kind: "park", label: "Park" },
  { pattern: /\btemple\b/i, kind: "temple", label: "Temple" },
  { pattern: /\bgate\b/i, kind: "gate", label: "Gate" },
  { pattern: /\bclub(house)?\b/i, kind: "clubhouse", label: "Clubhouse" },
  { pattern: /\b(garden|common)\b/i, kind: "common_area", label: "Common area" },
  { pattern: /\b(pond|lake|water)\b/i, kind: "water_body", label: "Water body" },
  // An office (sales office, management office) is real content on the
  // plan but not sellable inventory — reclassified the same way a
  // park/gate/clubhouse is, not rejected. "other" is the closest existing
  // site_feature_kind; nothing more specific fits and adding a new enum
  // value for one label isn't worth it. Deliberately does NOT cover
  // "commercial" — a Commercial Plot IS real inventory and must stay a
  // plot, which is exactly why this list has its own narrow "office" entry
  // rather than a broader word that could accidentally also match that.
  { pattern: /\boffice\b/i, kind: "other", label: "Office" },
];

// Content that shows up on a real site plan but is never itself a plot:
// the plot-schedule/legend box, a distance-meter/landmark table, and
// generic marketing-tagline language from a logo/title block. Deliberately
// generic (not tied to any one developer's plan) and deliberately narrow —
// this is a SAFETY FILTER applied only after a shape already cleared every
// geometric check in plots.ts (area/solidity/vertex-count) and OCR read it
// with real confidence (see the MIN_CONFIDENCE guard at its one call site
// below); it must never be the thing that decides a shape isn't a plot,
// only ever a late veto on a small, explicit set of known non-plot phrases.
// "commercial" is deliberately absent — a Commercial Plot is real
// inventory and must survive this check.
const NON_PLOT_KEYWORDS =
  /\b(schedule|legend|distance|meter|km|mtr|bypass|hospital|school|college|airport|township|colony|striving)\b/i;

// A compass rosette's own N/S/E/W labels — checked as an EXACT match on
// the whole trimmed OCR read, not a substring match, so this can never
// accidentally fire on a real plot number (plot numbers are pure digits,
// so this is already moot in practice, but exact-match is the more
// conservative form regardless of that).
const BARE_COMPASS_LETTER = /^[NSEW]$/i;

function isNonPlotContent(ocrText: string): boolean {
  const trimmed = ocrText.trim();
  return NON_PLOT_KEYWORDS.test(trimmed) || BARE_COMPASS_LETTER.test(trimmed);
}

const ROAD_NUMBER = /(\d+)/;
// Road width labels are always written as "<number>' WIDE" (a straight or
// curly apostrophe, sometimes a trailing -0"/-0'' foot-inch remainder) —
// matching that specific shape first is far more reliable than grabbing
// the first digit sequence anywhere in a crop (ROAD_NUMBER below), which
// can misfire on an unrelated nearby number — a plot's own dimension
// label bleeding into the same crop — instead of the road's actual width.
// Covers every width this pipeline is expected to recognize (30'/40'/60'/
// 100'/150' WIDE, etc.) since it's a number-shape pattern, not a fixed list.
// The apostrophe-like class also accepts a straight/curly DOUBLE quote —
// found necessary via direct evidence, not a hypothetical: OCR-ing a real
// road label (BALAJI VIHAR's "ROAD 30' WIDE", after the orientation fix
// below made it legible at all) read back as `30" WIDE`, Tesseract having
// misread the foot-mark as a double rather than single quote. Without this,
// a correctly-oriented, keyword-matched crop would still miss the precise
// width and fall through to the much weaker bare-digit fallback below,
// which has no way to prefer "the number right before WIDE" over an
// unrelated number elsewhere in the same crop.
const ROAD_WIDTH_LABEL = /(\d{1,3})\s*['’′"”″]?\s*(?:-\s*0\s*["”″]?)?\s*WIDE/i;
// Confirms a road candidate's OWN OCR crop actually mentions something
// road-related — used to BOOST an already-geometrically-plausible paired
// candidate's confidence, AND (see detection/roads.ts's single-line
// fallback) as the ONLY thing standing between a merely-long unpaired
// line and being treated as a road — a plot boundary that happens to have
// nearby text reading "40" from an unrelated number should never become a
// road just because a digit matched; requiring an actual road WORD (not
// just ROAD_NUMBER) keeps this from being that permissive. "width"
// (distinct from "wide") added after a real labeling convention was found
// via direct evidence: a plan labeling one road "TOTAL WIDTH 250" with a
// plain number, no "WIDE" anywhere in that specific phrase.
//
// Deliberately does NOT include the bare abbreviation "rd" — found to be a
// real false-positive source, not a hypothetical one: on a real plan
// (BALAJI VIHAR) a short, noisy road crop produced a stray two-letter OCR
// token that read as "rd" at 62% confidence, purely by coincidence (the
// actual nearby content was an unrelated plot's dimension figures), which
// was then enough on its own to mislabel that candidate as a road at
// confidence 0.42. "road" spelled out in full already covers every real
// case confirmed so far; a bare two-letter abbreviation is too easy for
// OCR noise to produce by accident to trust as road-specific evidence.
const ROAD_KEYWORDS = /\b(road|proposed|wide|width|highway)\b/i;
// How much a confirmed keyword match adds to a candidate's confidence —
// enough to carry a borderline geometric reading (e.g. right at
// MIN_GEOMETRIC_CONFIDENCE) up past MIN_FINAL_CONFIDENCE, without being so
// large that text alone could matter more than the corridor geometry that
// got it considered in the first place.
const ROAD_KEYWORD_CONFIDENCE_BOOST = 0.3;

// Below this, an OCR result is treated the same as "found nothing" rather
// than trusted to auto-fill a label — a wrong-but-confident-looking label
// is worse for the reviewer than an empty one they're prompted to fill in.
const MIN_CONFIDENCE = 55;

function boundingBox(points: PolygonPoint[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function cropCanvas(source: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      source,
      Math.max(0, sx),
      Math.max(0, sy),
      Math.min(sw, source.width - Math.max(0, sx)),
      Math.min(sh, source.height - Math.max(0, sy)),
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }
  return canvas;
}

// Crops a strip of size (along x across) centered at (cxPx,cyPx), rotated so
// that direction `angleRad` (the road's OWN direction, in source-image
// pixel space) comes out horizontal — then upscales the result by `scale`.
// This exists because a steep or diagonal road's own width label is
// conventionally hand-drafted rotated to run WITH the line, not
// horizontally on the page. Tesseract's PSM.SINGLE_BLOCK mode (required
// elsewhere in this file for its own good reasons — see ocrWorker.ts) does
// NOT itself try rotated text; it just fails. Confirmed directly, not
// assumed: cropping BALAJI VIHAR's real "PROPOSED ROAD 150' WIDE" label
// axis-aligned read as pure garbage (confidence 32, nonsense symbols) in
// EVERY orientation tried (unrotated, and both fixed +/-90 degree
// rotations) — because that label's actual angle is only ~86 degrees, not
// exactly 90. Rotating by the road's own measured angle (not a fixed
// guess) instead read "PROPOSED ROAD 150' WIDE" cleanly at 76% confidence.
// Implemented as two steps — rotate a generously-sized square first, then
// crop down tight to just the along x across strip — so the final crop
// handed to Tesseract stays small and free of unrelated neighboring text,
// rather than a single wide rotated crop that risks catching a nearby
// plot's own unrelated dimension number (confirmed as a real risk: an
// early, wider version of this crop pulled in a neighboring "25'" dimension
// label alongside the real "30' WIDE" text).
function cropCanvasOriented(
  source: HTMLCanvasElement,
  cxPx: number,
  cyPx: number,
  along: number,
  across: number,
  angleRad: number,
  scale: number,
): HTMLCanvasElement {
  const safeSize = Math.max(1, Math.round(Math.hypot(along, across)));
  const rotated = document.createElement("canvas");
  rotated.width = safeSize;
  rotated.height = safeSize;
  const rctx = rotated.getContext("2d");
  if (rctx) {
    rctx.fillStyle = "white";
    rctx.fillRect(0, 0, safeSize, safeSize);
    rctx.translate(safeSize / 2, safeSize / 2);
    rctx.rotate(-angleRad);
    rctx.drawImage(
      source,
      Math.max(0, cxPx - safeSize / 2),
      Math.max(0, cyPx - safeSize / 2),
      Math.min(safeSize, source.width - Math.max(0, cxPx - safeSize / 2)),
      Math.min(safeSize, source.height - Math.max(0, cyPx - safeSize / 2)),
      -safeSize / 2,
      -safeSize / 2,
      safeSize,
      safeSize,
    );
  }

  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(along * scale));
  out.height = Math.max(1, Math.round(across * scale));
  const octx = out.getContext("2d");
  if (octx) {
    octx.imageSmoothingEnabled = true;
    octx.fillStyle = "white";
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(rotated, safeSize / 2 - along / 2, safeSize / 2 - across / 2, along, across, 0, 0, out.width, out.height);
  }
  return out;
}

// Picks an upscale factor from the crop's OWN native size rather than
// applying a fixed multiplier everywhere — found necessary via direct
// testing: BALAJI VIHAR (a 1190x1684 scan) needed roughly a 3x bump before
// Tesseract's confidence crossed MIN_CONFIDENCE at all on its smallest road
// labels, but blindly applying that same 3x to a much higher-resolution
// source (e.g. Naman Infracity's 6144px-wide photo, whose native crop is
// already large) would needlessly multiply that crop's pixel area 9x for
// no legibility benefit, slowing OCR for no reason. Clamped to never
// upscale more than 4x (past which blur outweighs any benefit) and never
// downscale below native resolution.
const ROAD_LABEL_TARGET_ALONG_PX = 700;

function roadLabelOcrScale(alongPx: number): number {
  return Math.max(1, Math.min(4, ROAD_LABEL_TARGET_ALONG_PX / alongPx));
}

// Returns null to mean "drop this shape entirely" — reserved for a plot
// candidate whose own OCR text confidently reads as legend/distance-table/
// title/compass content per isNonPlotContent() above, never for a feature
// (a feature match returns two lines below, before this is ever reached)
// and never for a manually-drawn shape (a reviewer's own action is never
// second-guessed by this).
async function labelClosedShape(shape: DetectedShape, sourceCanvas: HTMLCanvasElement): Promise<DetectedShape | null> {
  const box = boundingBox(shape.points);
  const w = (box.maxX - box.minX) * sourceCanvas.width;
  const h = (box.maxY - box.minY) * sourceCanvas.height;
  // Inset by a fraction of the box's own size — this is the actual fix,
  // not a tuning nicety: OCR-ing right up to a plot's boundary reliably
  // misreads the boundary stroke itself as text.
  const insetX = w * 0.15;
  const insetY = h * 0.15;
  const sw = w - insetX * 2;
  const sh = h - insetY * 2;
  if (sw < 8 || sh < 8) return shape; // too small to meaningfully crop/OCR

  const crop = cropCanvas(sourceCanvas, box.minX * sourceCanvas.width + insetX, box.minY * sourceCanvas.height + insetY, sw, sh);

  let result: OcrCropResult;
  try {
    result = await recognizeCrop(crop);
  } catch {
    return shape;
  }
  if (!result.text || result.confidence < MIN_CONFIDENCE) return shape;

  for (const { pattern, kind, label } of FEATURE_KEYWORDS) {
    if (pattern.test(result.text)) {
      return { ...shape, kind: "feature", featureKind: kind, label, status: undefined };
    }
  }

  if (shape.kind === "plot" && shape.source === "detected" && isNonPlotContent(result.text)) {
    return null;
  }

  return { ...shape, label: result.text.split(/\s+/)[0] };
}

// Fraction of a road's own length to try, in order — 0.5 (the geometric
// midpoint) first since that's still the single most likely spot, then
// alternating outward. A real, previously-unnoticed gap found by directly
// testing against BALAJI VIHAR and Naman Infracity (both real plans, both
// with clearly visible "60' WIDE"/"30' WIDE"/"PROPOSED ROAD" labels):
// EVERY road came back with an empty label, on both plans, despite the
// text being right there on the source image. The label is written once
// somewhere along a road's length, not necessarily centered on whatever
// span THIS shape's own detected/merged centerline happens to cover
// (especially for a long or diagonal road, or one built from several
// paired-and-merged fragments) — sampling only the midpoint missed it
// every time. Stops at the first position that reads back a road-relevant
// result, so a typical road still costs one OCR call, not five.
const ROAD_LABEL_SAMPLE_POSITIONS = [0.5, 0.3, 0.7, 0.15, 0.85];

// A real road-width label is never outside this range on any real site
// plan (single-digit internal lanes up to a major arterial/highway).
// Guards the bare-digit fallback path below, where a nearby but unrelated
// number — a plot's own ID/area figure, a dimension label bleeding into
// the crop — could otherwise get printed as if it were the road's width.
// Found necessary via direct testing against BALAJI VIHAR: an early
// version of this function's fallback mislabeled a road "23197 ft" (that
// plan's own PLOT AREA figure, sitting nearby) and another "000 ft".
// Raised from 200 to 300 after direct evidence of a real plan labeling a
// road "TOTAL WIDTH 250" — a genuine major-road figure, not a misread.
const MIN_PLAUSIBLE_ROAD_WIDTH = 8;
const MAX_PLAUSIBLE_ROAD_WIDTH = 300;

function plausibleRoadWidthLabel(match: RegExpMatchArray | null): string | null {
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < MIN_PLAUSIBLE_ROAD_WIDTH || n > MAX_PLAUSIBLE_ROAD_WIDTH) return null;
  return `${n} ft`;
}

// Returns null to mean "drop this road candidate entirely" — the same
// contract labelClosedShape already uses for a plot whose own OCR text
// confidently reads as legend/distance-table/title content (see
// isNonPlotContent above). Found necessary via direct testing: the
// plot-schedule/distance-meter table on a real plan is visually a grid of
// roughly-parallel ruled lines with a fairly consistent gap and a blank,
// uniform interior between rows — geometrically indistinguishable from a
// real road corridor to the corridor-pairing check in roads.ts. If a
// candidate's own OCR crop confidently reads as that table's own content,
// that's strong direct evidence it's the table, not a road, and should
// veto the candidate the same way it already vetoes a plot.
async function labelRoad(shape: DetectedShape, sourceCanvas: HTMLCanvasElement): Promise<DetectedShape | null> {
  const a = shape.points[0];
  const b = shape.points[shape.points.length - 1];
  // Pixel-space direction, not fractional-coordinate direction — a plan
  // image is rarely square, so dividing x by width and y by height
  // separately (as the shape's own stored points do) distorts angles. The
  // road's own measured angle is what a hand-drafted label is rotated to
  // match (see cropCanvasOriented's doc comment for the direct evidence),
  // so getting the real angle right here matters.
  const aPx = { x: a.x * sourceCanvas.width, y: a.y * sourceCanvas.height };
  const bPx = { x: b.x * sourceCanvas.width, y: b.y * sourceCanvas.height };
  const lineAngle = Math.atan2(bPx.y - aPx.y, bPx.x - aPx.x);

  const longEdge = Math.max(sourceCanvas.width, sourceCanvas.height);
  const along = longEdge * 0.14;
  const across = longEdge * 0.07;
  const scale = roadLabelOcrScale(along);
  // A label can be hand-drafted reading either direction along its own
  // line (see cropCanvasOriented) — both are tried, forward first since
  // that already matches every currently-working horizontal case (a
  // horizontal road's lineAngle is ~0, so this is a pure generalization of
  // the previous unrotated crop, not a behavior change for those).
  const orientations = [lineAngle, lineAngle + Math.PI];

  let fallback: { text: string; confidence: number } | null = null;
  for (const t of ROAD_LABEL_SAMPLE_POSITIONS) {
    const cxPx = aPx.x + (bPx.x - aPx.x) * t;
    const cyPx = aPx.y + (bPx.y - aPx.y) * t;

    for (const angle of orientations) {
      const crop = cropCanvasOriented(sourceCanvas, cxPx, cyPx, along, across, angle, scale);

      // Per-WORD confidence, not recognizeCrop's whole-block average — a
      // real, confirmed-necessary distinction for a road crop specifically.
      // A plot's own interior crop (labelClosedShape, above) is small and
      // isolated enough that the block average works fine, but a road
      // label's crop routinely also catches a neighboring plot's unrelated
      // boundary lines and dimension text in the same frame (this box has
      // to be fairly generous to tolerate the sample point not landing
      // exactly on the label — see cropCanvasOriented). Confirmed directly
      // against BALAJI VIHAR's own "ROAD 30' WIDE": recognizeCrop's block
      // average on this exact crop was only 36-48 (below MIN_CONFIDENCE)
      // at every single sample position and orientation tried, even though
      // the label itself was sitting right there — because several other,
      // unrelated lines of garbage in the same crop (nearby dimension
      // numbers, stray boundary strokes) dragged the average down. The
      // SAME crop's own per-word breakdown reads "ROAD"=96, "30\""=92,
      // "WIDE"=94 — each far above MIN_CONFIDENCE on its own. Keeping only
      // words Tesseract itself is actually confident about, and judging
      // road-relevance from just those, finds the real label without
      // being penalized by noise elsewhere in the same frame.
      let words;
      try {
        words = await recognizeCropWords(crop);
      } catch {
        continue;
      }
      const confidentWords = words.filter((w) => w.confidence >= MIN_CONFIDENCE);
      if (confidentWords.length === 0) continue;
      const text = confidentWords.map((w) => w.text).join(" ");
      if (isNonPlotContent(text)) return null;
      if (!fallback) {
        fallback = { text, confidence: Math.max(...confidentWords.map((w) => w.confidence)) };
      }

      // Keyword match is confidence SUPPORT for a candidate the geometric
      // corridor detector already found plausible on its own — it never
      // decides "road" by itself (a candidate with no geometric support
      // never reaches this function with a meaningful confidence to boost).
      const keywordMatched = ROAD_KEYWORDS.test(text);
      const widthMatch = text.match(ROAD_WIDTH_LABEL);
      if (!keywordMatched && !widthMatch) continue; // this crop found text, but nothing road-relevant — try the next orientation/position

      const boostedConfidence = keywordMatched
        ? Math.min(1, (shape.confidence ?? 0) + ROAD_KEYWORD_CONFIDENCE_BOOST)
        : shape.confidence;
      const label = plausibleRoadWidthLabel(widthMatch ?? text.match(ROAD_NUMBER));
      return label ? { ...shape, label, confidence: boostedConfidence } : { ...shape, confidence: boostedConfidence };
    }
  }

  // No position/orientation matched a road-specific pattern — fall back to
  // whatever plain digit (if any) the first readable crop found, same as
  // the original single-crop behavior, rather than giving up on a label
  // entirely just because "WIDE"/"ROAD" itself wasn't legible. Still
  // gated by plausibleRoadWidthLabel — an unrelated nearby number is
  // exactly what this fallback (weakest evidence: no road keyword at all)
  // is most likely to pick up.
  if (!fallback) return shape;
  const label = plausibleRoadWidthLabel(fallback.text.match(ROAD_NUMBER));
  return label ? { ...shape, label } : shape;
}

export interface OcrLabelingOutcome {
  shapes: DetectedShape[];
  /** How many candidates were dropped as legend/distance-table/title/compass content — surfaced as a review-screen warning by the caller, never silent. */
  rejectedCount: number;
}

export async function labelShapesWithOcr(shapes: DetectedShape[], sourceCanvas: HTMLCanvasElement): Promise<OcrLabelingOutcome> {
  const results: DetectedShape[] = [];
  let rejectedCount = 0;
  for (const shape of shapes) {
    if (shape.kind === "road") {
      const labeledRoad = await labelRoad(shape, sourceCanvas);
      if (labeledRoad === null) {
        rejectedCount++;
        continue;
      }
      results.push(labeledRoad);
      continue;
    }
    const labeled = await labelClosedShape(shape, sourceCanvas);
    if (labeled === null) {
      rejectedCount++;
      continue;
    }
    results.push(labeled);
  }
  return { shapes: results, rejectedCount };
}
