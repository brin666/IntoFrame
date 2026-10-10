import * as THREE from "three";

export const CAMERA_DISTANCE = 3.5;
export const FOV = 35;
export const BACKGROUND_DEPTH_SPAN = 0.62;

export interface DepthMetadata {
  width: number;
  height: number;
  encoding: string;
  subjectP05: number;
  subjectP95: number;
  globalMin: number;
  globalMax: number;
}

export interface SubjectGeometry extends THREE.BufferGeometry {
  userData: {
    samples: Float32Array;
    validTriangles: number;
    skippedTriangles: number;
    updateStrength: (strength: number) => void;
  };
}

export function imagePixels(image: HTMLImageElement): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not read image pixels");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

export function worldFrame(height: number, width: number) {
  const visibleHeight = 2 * CAMERA_DISTANCE * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  return {
    visibleHeight,
    visibleWidth: (visibleHeight * width) / height,
    worldPerPixel: visibleHeight / height,
    focalPixels: height / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2))),
  };
}

/**
 * Reverse project native photo pixels using f = H/(2 tan(FOV/2)). The virtual
 * D values are an artistic range, never metres. At camera origin every vertex
 * reprojects to exactly its input pixel (apart from texture interpolation).
 */
export function createSubjectGeometry(
  depth: Float32Array,
  mask: Uint8ClampedArray,
  metadata: DepthMetadata,
  stageWidth: number,
  stageHeight: number,
): SubjectGeometry {
  const { width, height } = metadata;
  if (depth.length !== width * height || mask.length !== width * height * 4)
    throw new Error("Subject RGB, mask and float32 depth coordinates differ");
  const { visibleHeight } = worldFrame(stageHeight, stageWidth);
  const worldPerPixel = visibleHeight / height;
  const step = 4;
  const nx = Math.ceil(width / step) + 1;
  const ny = Math.ceil(height / step) + 1;
  const positions = new Float32Array(nx * ny * 3);
  const samples = new Float32Array(nx * ny * 3); // native px, native py, raw prediction
  const uv = new Float32Array(nx * ny * 2);
  const valid = new Uint8Array(nx * ny);
  const indices: number[] = [];
  const span = Math.max(1e-6, metadata.subjectP95 - metadata.subjectP05);
  let skippedTriangles = 0;
  const vertexIndex = (x: number, y: number) => y * nx + x;
  for (let gy = 0; gy < ny; gy++) {
    const py = Math.min(height - 1, gy * step);
    for (let gx = 0; gx < nx; gx++) {
      const px = Math.min(width - 1, gx * step);
      const i = vertexIndex(gx, gy);
      // Small 3x3 mean dampens bicubic ringing without clipping the float prediction.
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const sy = Math.max(0, Math.min(height - 1, py + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const sx = Math.max(0, Math.min(width - 1, px + dx));
          sum += depth[sy * width + sx];
          count++;
        }
      }
      samples.set([px, py, sum / count], i * 3);
      uv.set([px / (width - 1), 1 - py / (height - 1)], i * 2);
      valid[i] = mask[(py * width + px) * 4] >= 8 ? 1 : 0;
    }
  }

  // Keep the principal connected silhouette. BiRefNet can leave detached sky
  // flecks; those become obvious floating shards once the subject is meshed.
  const visited = new Uint8Array(valid.length);
  const stack: number[] = [];
  let principal: number[] = [];
  for (let seed = 0; seed < valid.length; seed++) {
    if (!valid[seed] || visited[seed]) continue;
    const component: number[] = [];
    stack.push(seed);
    visited[seed] = 1;
    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      const x = current % nx;
      const y = Math.floor(current / nx);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
          const neighbor = vertexIndex(xx, yy);
          if (valid[neighbor] && !visited[neighbor]) {
            visited[neighbor] = 1;
            stack.push(neighbor);
          }
        }
      }
    }
    if (component.length > principal.length) principal = component;
  }
  if (principal.length < 100) throw new Error("The mask has too little connected subject geometry");
  valid.fill(0);
  for (const index of principal) valid[index] = 1;

  function pushTriangle(a: number, b: number, c: number) {
    const values = [samples[a * 3 + 2], samples[b * 3 + 2], samples[c * 3 + 2]];
    // No triangle may bridge a mask gap or a sharp depth discontinuity.
    if (!valid[a] || !valid[b] || !valid[c] || Math.max(...values) - Math.min(...values) > 0.55) {
      skippedTriangles++;
      return;
    }
    indices.push(a, b, c);
  }
  for (let y = 0; y < ny - 1; y++) {
    for (let x = 0; x < nx - 1; x++) {
      const a = vertexIndex(x, y);
      const b = vertexIndex(x + 1, y);
      const c = vertexIndex(x, y + 1);
      const d = vertexIndex(x + 1, y + 1);
      // Photo-space y is downward; these windings face the camera after inversion.
      pushTriangle(a, c, b);
      pushTriangle(b, c, d);
    }
  }
  if (indices.length < 300) throw new Error("The subject mesh has too few valid triangles");
  const geometry = new THREE.BufferGeometry() as SubjectGeometry;
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(indices);

  function updateStrength(strength: number) {
    for (let i = 0; i < nx * ny; i++) {
      const px = samples[i * 3];
      const py = samples[i * 3 + 1];
      const raw = samples[i * 3 + 2];
      // Increasing raw prediction is nearer. Clamp only at the chosen virtual
      // display range; the transmitted data and per-vertex samples remain raw.
      const near = THREE.MathUtils.clamp((raw - metadata.subjectP05) / span, 0, 1);
      // Even at the debug maximum (1.6x), D <= 2.87, while the nearest
      // background surface is at D = 3.5 - 0.62 = 2.88.
      const distance = 2.55 - strength * (near - 0.5) * 0.4;
      positions[i * 3] = (px - (width - 1) / 2) * worldPerPixel * distance / CAMERA_DISTANCE;
      positions[i * 3 + 1] = ((height - 1) / 2 - py) * worldPerPixel * distance / CAMERA_DISTANCE;
      positions[i * 3 + 2] = CAMERA_DISTANCE - distance;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }
  geometry.userData = {
    samples,
    validTriangles: indices.length / 3,
    skippedTriangles,
    updateStrength,
  };
  updateStrength(1);
  return geometry;
}

export function createBackgroundGeometry(
  depthPixels: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  renderWidth: number,
  renderHeight: number,
  stageWidth: number,
  stageHeight: number,
) {
  const { visibleWidth, visibleHeight } = worldFrame(stageHeight, stageWidth);
  const geometry = new THREE.PlaneGeometry(
    visibleWidth * renderWidth / sourceWidth,
    visibleHeight * renderHeight / sourceHeight,
    96,
    96,
  );
  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) {
    const x = Math.round(uvs.getX(i) * (renderWidth - 1));
    const y = Math.round((1 - uvs.getY(i)) * (renderHeight - 1));
    const z = depthPixels[(y * renderWidth + x) * 4] / 255 * BACKGROUND_DEPTH_SPAN;
    const compensation = (CAMERA_DISTANCE - z) / CAMERA_DISTANCE;
    positions.setXYZ(i, positions.getX(i) * compensation, positions.getY(i) * compensation, z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}
