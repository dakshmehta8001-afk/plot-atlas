// Reads an image's pixel size straight from its file header, without decoding
// it. Used when a plan image is uploaded so the project can store its width and
// height: the map then knows the right shape from the very first render, instead
// of waiting for the browser to download the image (see useImageAspectRatio).
//
// Handles PNG, JPEG (honouring the EXIF rotation tag, because browsers show
// rotated photos upright), WebP and GIF. Returns null for anything else.
export interface ImageSize {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));

export function readImageSize(b: Uint8Array): ImageSize | null {
  // PNG: 8-byte signature, then the IHDR chunk holding width and height.
  if (b.length > 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG") {
    return { width: u32be(b, 16), height: u32be(b, 20) };
  }
  // GIF: "GIF8", then little-endian width and height.
  if (b.length > 10 && ascii(b, 0, 4) === "GIF8") {
    return { width: u16le(b, 6), height: u16le(b, 8) };
  }
  // WebP: RIFF container with a VP8, VP8L or VP8X chunk.
  if (b.length > 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const kind = ascii(b, 12, 4);
    if (kind === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    if (kind === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8 ") return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    return null;
  }
  // JPEG: walk the marker segments to the start-of-frame marker.
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let orientation = 1;
    let o = 2;
    while (o + 4 < b.length) {
      if (b[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = b[o + 1];
      if (marker === 0xff) {
        o++;
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        o += 2;
        continue;
      }
      const len = u16be(b, o + 2);
      if (marker === 0xe1 && ascii(b, o + 4, 4) === "Exif") orientation = exifOrientation(b, o + 10, len - 8);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        const height = u16be(b, o + 5);
        const width = u16be(b, o + 7);
        // Orientations 5-8 turn the picture on its side.
        return orientation >= 5 ? { width: height, height: width } : { width, height };
      }
      o += 2 + len;
    }
  }
  return null;
}

// EXIF orientation tag (0x0112) from a TIFF block; 1 (upright) if absent.
function exifOrientation(b: Uint8Array, start: number, length: number): number {
  if (length < 14 || start + length > b.length) return 1;
  const little = b[start] === 0x49; // "II" little-endian, "MM" big-endian
  const r16 = (o: number) => (little ? u16le(b, start + o) : u16be(b, start + o));
  const r32 = (o: number) => (little ? (u16le(b, start + o) | (u16le(b, start + o + 2) << 16)) >>> 0 : u32be(b, start + o));
  const ifd = r32(4);
  if (ifd + 2 > length) return 1;
  const count = r16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > length) break;
    if (r16(e) === 0x0112) return r16(e + 8);
  }
  return 1;
}
