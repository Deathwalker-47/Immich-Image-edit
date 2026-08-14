/**
 * Output sizing.
 *
 * Providers reject requests whose dimensions fall outside a model's accepted set,
 * and the accepted set differs sharply per model (see DimensionRule in models.ts).
 * Everything here takes the SOURCE image's aspect ratio and produces dimensions the
 * target model will actually accept, so a portrait photo comes back portrait rather
 * than squashed into a square.
 */

import { DimensionRule } from './models';

export interface Size {
  width: number;
  height: number;
}

/** What to send to the provider: explicit dimensions, a preset, or nothing at all. */
export type ResolvedSize =
  | { kind: 'dimensions'; width: number; height: number }
  | { kind: 'resolution'; resolution: string }
  | { kind: 'none' };

const FALLBACK_ASPECT = 1;

function aspectOf(source?: Size): number {
  if (!source || !source.width || !source.height) return FALLBACK_ASPECT;
  return source.width / source.height;
}

/** Round to the nearest multiple of `increment`, staying within [min, max]. */
function snap(value: number, increment: number, min: number, max: number): number {
  const clamped = Math.min(Math.max(value, min), max);
  const snapped = Math.round(clamped / increment) * increment;
  // Rounding can push back outside the range; pull it in and stay on-increment.
  if (snapped < min) return Math.ceil(min / increment) * increment;
  if (snapped > max) return Math.floor(max / increment) * increment;
  return snapped;
}

/** Pick the pair from a fixed list whose aspect ratio is closest to the source. */
function closestPair(pairs: [number, number][], aspect: number): Size {
  let best = pairs[0];
  let bestDelta = Infinity;
  for (const pair of pairs) {
    const delta = Math.abs(pair[0] / pair[1] - aspect);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = pair;
    }
  }
  return { width: best[0], height: best[1] };
}

/**
 * Fit an aspect ratio into an edge range, honouring an optional total-area band.
 *
 * Area is the binding constraint for models like Seedream 4.5 (3.69-16.78MP): a
 * naive 1024x1024 sits under the floor and the request is rejected outright.
 */
function fitRange(
  aspect: number,
  minEdge: number,
  maxEdge: number,
  increment: number,
  minPixels?: number,
  maxPixels?: number
): Size {
  // Start from the largest box that fits the edge limits at this aspect ratio.
  let width: number;
  let height: number;
  if (aspect >= 1) {
    width = maxEdge;
    height = maxEdge / aspect;
  } else {
    height = maxEdge;
    width = maxEdge * aspect;
  }

  // Shrink toward the area ceiling if we overshot it.
  if (maxPixels && width * height > maxPixels) {
    const scale = Math.sqrt(maxPixels / (width * height));
    width *= scale;
    height *= scale;
  }

  // Grow toward the area floor if we're under it. Only meaningful when the edge
  // limits leave room; the clamp below keeps us legal either way.
  if (minPixels && width * height < minPixels) {
    const scale = Math.sqrt(minPixels / (width * height));
    width *= scale;
    height *= scale;
  }

  let finalWidth = snap(width, increment, minEdge, maxEdge);
  let finalHeight = snap(height, increment, minEdge, maxEdge);

  // The pre-snap width/height were scaled so their (floating-point) product sits
  // right at the area ceiling. snap() then rounds each dimension independently —
  // two roundings in the same direction can push the *integer* product back over
  // maxPixels even though the float product was exactly on the boundary. Confirmed
  // live against Seedream 4.5 on Runware: 4730x3547 = 16,777,310, 94px over a
  // 16,777,216 ceiling, rejected as invalidPixels. Step both dimensions back down
  // until the integer area is legal again.
  if (maxPixels) {
    let guard = 0;
    while (finalWidth * finalHeight > maxPixels && guard < 512) {
      const nextWidth = Math.max(finalWidth - increment, minEdge);
      const nextHeight = Math.max(finalHeight - increment, minEdge);
      if (nextWidth === finalWidth && nextHeight === finalHeight) break;
      finalWidth = nextWidth;
      finalHeight = nextHeight;
      guard += 1;
    }
  }

  // Snapping and clamping can also nudge the area back under the floor. Step both
  // dimensions up until the area is legal or we run out of headroom.
  if (minPixels) {
    let guard = 0;
    while (finalWidth * finalHeight < minPixels && guard < 512) {
      const nextWidth = Math.min(finalWidth + increment, maxEdge);
      const nextHeight = Math.min(finalHeight + increment, maxEdge);
      if (nextWidth === finalWidth && nextHeight === finalHeight) break;
      finalWidth = nextWidth;
      finalHeight = nextHeight;
      guard += 1;
    }
  }

  return { width: finalWidth, height: finalHeight };
}

/**
 * Work out what size to request for one model, given the source image.
 *
 * `source` is optional — when the input dimensions are unknown we fall back to a
 * square aspect rather than failing, since a wrong-but-legal size still produces an
 * image while an out-of-range one produces an API error.
 */
export function resolveSize(rule: DimensionRule, source?: Size): ResolvedSize {
  const aspect = aspectOf(source);

  switch (rule.kind) {
    case 'fixed-list': {
      const { width, height } = closestPair(rule.pairs, aspect);
      return { kind: 'dimensions', width, height };
    }
    case 'range': {
      const { width, height } = fitRange(
        aspect,
        rule.minEdge,
        rule.maxEdge,
        rule.increment,
        rule.minPixels,
        rule.maxPixels
      );
      return { kind: 'dimensions', width, height };
    }
    case 'resolution-preset':
      return { kind: 'resolution', resolution: rule.preset };
    case 'provider-default':
      return { kind: 'none' };
  }
}

/**
 * Read the pixel dimensions out of an encoded image without pulling in an image
 * library. Only the handful of headers we actually receive are parsed; anything
 * else returns undefined and callers fall back to a square aspect.
 */
export function readImageSize(buffer: Buffer): Size | undefined {
  if (buffer.length < 24) return undefined;

  // PNG: 8-byte signature, then IHDR with width/height as big-endian uint32.
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  ) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  // GIF: 'GIF8', then width/height as little-endian uint16.
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }

  // WEBP: 'RIFF'....'WEBP'. Three sub-formats store the size differently.
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const format = buffer.toString('ascii', 12, 16);
    if (format === 'VP8 ' && buffer.length >= 30) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
    if (format === 'VP8L' && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (format === 'VP8X' && buffer.length >= 30) {
      const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
      const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
      return { width, height };
    }
    return undefined;
  }

  // JPEG: walk the segment markers to the SOFn frame header.
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      // SOF0-SOF15, excluding the non-frame markers DHT(c4), JPG(c8) and DAC(cc).
      if (
        marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      ) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      const segmentLength = buffer.readUInt16BE(offset + 2);
      if (segmentLength <= 0) break;
      offset += 2 + segmentLength;
    }
  }

  return undefined;
}
