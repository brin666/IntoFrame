import type { MeshDepthMetadata } from "./api";
import { CAMERA_DISTANCE, FOV, subjectZ } from "./parallax";

const RELIEF_HALF_SPAN = 0.36;
const MAX_DEPTH_SLOPE = 12;

export interface DepthSurface {
  width: number;
  height: number;
  columns: number;
  rows: number;
  depths: Float32Array;
  nearestZ: number;
  farthestZ: number;
  referenceZ: number;
}

export interface PhotoGeometryData {
  positions: Float32Array;
  uv: Float32Array;
  indices: Uint32Array;
  /** Source coordinates make center projection independently verifiable. */
  sourceCoordinates: Float32Array;
}

export function decodeMeshDepth(
  buffer: ArrayBuffer,
  metadata: MeshDepthMetadata,
  width: number,
  height: number,
): Float32Array {
  if (
    metadata.encoding !== "float32-little-endian-row-major" ||
    metadata.width !== width || metadata.height !== height ||
    !Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 ||
    buffer.byteLength !== width * height * 4
  ) throw new Error("Native depth coordinates do not match this photo.");
  const statistics = [metadata.subjectP05, metadata.subjectP95, metadata.subjectMedian,
    metadata.globalP02, metadata.globalP98, metadata.globalMin, metadata.globalMax];
  if (statistics.some((value) => !Number.isFinite(value)) ||
    metadata.globalMin > metadata.globalP02 || metadata.globalP02 >= metadata.globalP98 ||
    metadata.globalP98 > metadata.globalMax || metadata.subjectP05 > metadata.subjectMedian ||
    metadata.subjectMedian > metadata.subjectP95)
    throw new Error("Native depth statistics are invalid.");
  const globalRange = metadata.globalP98 - metadata.globalP02;
  if (metadata.subjectP95 - metadata.subjectP05 <= Math.max(1e-6, globalRange * 0.01))
    throw new Error("The subject has too little reliable local depth.");
  // DataView specifies the wire byte order, independently of the device CPU.
  const view = new DataView(buffer);
  const values = new Float32Array(width * height);
  for (let i = 0; i < values.length; i++) {
    const value = view.getFloat32(i * 4, true);
    if (!Number.isFinite(value)) throw new Error("Native depth contains invalid samples.");
    values[i] = value;
  }
  return values;
}

/**
 * One continuous depth field is used by both the subject and its support scene.
 * Coverage only chooses depth samples: the full grid remains indexed and the
 * original alpha texture supplies every silhouette pixel, including ornaments.
 */
export function createDepthSurface(
  raw: Float32Array,
  metadata: MeshDepthMetadata,
  foregroundDepth: number,
  coverage?: Uint8Array,
): DepthSurface {
  const { width, height } = metadata;
  if (raw.length !== width * height || (coverage && coverage.length !== raw.length))
    throw new Error("Native depth and alpha coordinates differ.");
  const columns = Math.min(320, Math.max(2, Math.ceil(width / 4))) + 1;
  const rows = Math.min(320, Math.max(2, Math.ceil(height / 4))) + 1;
  const depths = new Float32Array(columns * rows);
  const filled = new Uint8Array(depths.length);
  const queue = new Int32Array(depths.length);
  const referenceZ = subjectZ(foregroundDepth);
  const farRange = Math.max(metadata.subjectMedian - metadata.subjectP05,
    (metadata.subjectP95 - metadata.subjectP05) * 0.1);
  const nearRange = Math.max(metadata.subjectP95 - metadata.subjectMedian,
    (metadata.subjectP95 - metadata.subjectP05) * 0.1);
  let queueEnd = 0;
  for (let gy = 0; gy < rows; gy++) {
    const py = Math.round((gy * (height - 1)) / (rows - 1));
    for (let gx = 0; gx < columns; gx++) {
      const px = Math.round((gx * (width - 1)) / (columns - 1));
      let sum = 0;
      let weight = 0;
      // A small alpha-weighted kernel excludes the unrelated sky depth at a
      // silhouette. It does not threshold or remove any texture/triangle.
      for (let dy = -1; dy <= 1; dy++) {
        const sy = Math.max(0, Math.min(height - 1, py + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const sx = Math.max(0, Math.min(width - 1, px + dx));
          const source = sy * width + sx;
          const alpha = coverage ? coverage[source] / 255 : 1;
          sum += raw[source] * alpha;
          weight += alpha;
        }
      }
      const i = gy * columns + gx;
      if (weight <= 0.01) continue;
      const difference = sum / weight - metadata.subjectMedian;
      const local = difference / (difference < 0 ? farRange : nearRange);
      depths[i] = referenceZ + RELIEF_HALF_SPAN * Math.max(-1, Math.min(1, local));
      filled[i] = 1;
      queue[queueEnd++] = i;
    }
  }
  if (queueEnd < 4) throw new Error("The subject has too little depth coverage.");
  // Extend geometry beneath transparent pixels instead of sinking it to sky
  // depth. Small alpha features between grid nodes retain a supported surface.
  for (let head = 0; head < queueEnd; head++) {
    const i = queue[head];
    const x = i % columns;
    const y = Math.floor(i / columns);
    const neighbours = [x > 0 ? i - 1 : -1, x < columns - 1 ? i + 1 : -1,
      y > 0 ? i - columns : -1, y < rows - 1 ? i + columns : -1];
    for (const neighbour of neighbours) {
      if (neighbour < 0 || filled[neighbour]) continue;
      filled[neighbour] = 1;
      depths[neighbour] = depths[i];
      queue[queueEnd++] = neighbour;
    }
  }
  // Average the upper and lower Lipschitz envelopes. Both are continuous and
  // slope-bounded, so a depth step becomes a short ramp instead of a curtain.
  // Unlike triangle rejection this cannot open holes along a thin silhouette.
  const upper = depths.slice();
  const lower = depths.slice();
  const dxLimit = MAX_DEPTH_SLOPE * width / ((columns - 1) * Math.max(width, height));
  const dyLimit = MAX_DEPTH_SLOPE * height / ((rows - 1) * Math.max(width, height));
  const limit = (current: number, neighbour: number, delta: number) => {
    upper[current] = Math.min(upper[current], upper[neighbour] + delta);
    lower[current] = Math.max(lower[current], lower[neighbour] - delta);
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 1; x < columns; x++) limit(y * columns + x, y * columns + x - 1, dxLimit);
    for (let x = columns - 2; x >= 0; x--) limit(y * columns + x, y * columns + x + 1, dxLimit);
  }
  for (let x = 0; x < columns; x++) {
    for (let y = 1; y < rows; y++) limit(y * columns + x, (y - 1) * columns + x, dyLimit);
    for (let y = rows - 2; y >= 0; y--) limit(y * columns + x, (y + 1) * columns + x, dyLimit);
  }
  let nearestZ = -Infinity;
  let farthestZ = Infinity;
  for (let i = 0; i < depths.length; i++) {
    depths[i] = (upper[i] + lower[i]) / 2;
    nearestZ = Math.max(nearestZ, depths[i]);
    farthestZ = Math.min(farthestZ, depths[i]);
  }
  if (nearestZ - farthestZ < 0.08)
    throw new Error("The subject has too little reliable local depth.");
  return { width, height, columns, rows, depths, nearestZ, farthestZ, referenceZ };
}

function reflect(value: number, maximum: number): number {
  if (maximum <= 0) return 0;
  const period = maximum * 2;
  const position = ((value % period) + period) % period;
  return position <= maximum ? position : period - position;
}

/** Native photo edge coordinates, rather than pixel centers. */
export function sampleSurface(surface: DepthSurface, px: number, py: number): number {
  const x = reflect(px, surface.width) / surface.width * (surface.columns - 1);
  const y = reflect(py, surface.height) / surface.height * (surface.rows - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(surface.columns - 1, x0 + 1);
  const y1 = Math.min(surface.rows - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const a = surface.depths[y0 * surface.columns + x0] * (1 - fx) +
    surface.depths[y0 * surface.columns + x1] * fx;
  const b = surface.depths[y1 * surface.columns + x0] * (1 - fx) +
    surface.depths[y1 * surface.columns + x1] * fx;
  return a * (1 - fy) + b * fy;
}

function gridCoordinates(size: number, count: number, before: number, after: number): number[] {
  const step = size / (count - 1);
  const coordinates: number[] = [];
  if (before > 0) {
    coordinates.push(-before);
    for (let n = Math.ceil(before / step) - 1; n > 0; n--) coordinates.push(-n * step);
  }
  for (let n = 0; n < count; n++) coordinates.push(n * step);
  if (after > 0) {
    for (let n = 1; n * step < after; n++) coordinates.push(size + n * step);
    coordinates.push(size + after);
  }
  return coordinates;
}

/** Center camera projects every grid vertex back to the exact input image edge. */
export function createPhotoGeometryData(
  surface: DepthSurface,
  aspect: number,
  padding = { left: 0, right: 0, top: 0, bottom: 0 },
): PhotoGeometryData {
  const xs = gridCoordinates(surface.width, surface.columns, padding.left, padding.right);
  const ys = gridCoordinates(surface.height, surface.rows, padding.top, padding.bottom);
  const visibleHeight = 2 * CAMERA_DISTANCE * Math.tan(FOV * Math.PI / 360);
  const visibleWidth = visibleHeight * aspect;
  const positions = new Float32Array(xs.length * ys.length * 3);
  const uv = new Float32Array(xs.length * ys.length * 2);
  const sourceCoordinates = new Float32Array(xs.length * ys.length * 2);
  const indices = new Uint32Array((xs.length - 1) * (ys.length - 1) * 6);
  for (let y = 0; y < ys.length; y++) {
    for (let x = 0; x < xs.length; x++) {
      const i = y * xs.length + x;
      const px = xs[x];
      const py = ys[y];
      const z = sampleSurface(surface, px, py);
      const compensation = (CAMERA_DISTANCE - z) / CAMERA_DISTANCE;
      positions.set([(px / surface.width - 0.5) * visibleWidth * compensation,
        (0.5 - py / surface.height) * visibleHeight * compensation, z], i * 3);
      uv.set([(px + padding.left) / (surface.width + padding.left + padding.right),
        1 - (py + padding.top) / (surface.height + padding.top + padding.bottom)], i * 2);
      sourceCoordinates.set([px, py], i * 2);
    }
  }
  let cursor = 0;
  for (let y = 0; y < ys.length - 1; y++) {
    for (let x = 0; x < xs.length - 1; x++) {
      const a = y * xs.length + x;
      const b = a + 1;
      const c = a + xs.length;
      const d = c + 1;
      indices.set([a, c, b, b, c, d], cursor);
      cursor += 6;
    }
  }
  return { positions, uv, indices, sourceCoordinates };
}
