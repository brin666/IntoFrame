/** Camera and layer depths shared by the rendered scene and motion calculation. */
export const CAMERA_DISTANCE = 3.5;
export const FOV = 35;
export const SKY_Z = -0.8;
export const DEPTH_SPAN = 0.62;

type SubjectBounds = readonly [number, number, number, number];

export interface SubjectStats {
  occupancy: number;
  leftEdgeFraction: number;
  rightEdgeFraction: number;
}

export interface ParallaxOptions {
  /** The preview size in CSS pixels, before its composition transform. */
  width: number;
  height: number;
  zoom: number;
  /** The composition translation as a fraction of preview width. */
  shiftX: number;
  sourceWidth: number;
  /** Background overscan in source pixels. A number means equal side padding. */
  paddingX: number | { left: number; right: number };
  subjectBounds: SubjectBounds;
  subjectStats?: SubjectStats;
  foregroundDepth: number;
  touch: boolean;
  travelScale: number;
  /** The generated sky uses SKY_Z; the original photo can use zero. */
  backgroundZ?: number;
  /** Representative and nearest z of the geometry actually being rendered. */
  subjectReferenceZ?: number;
  nearestZ?: number;
  /** Maximum forward camera movement; safety uses its closest position. */
  cameraAdvance?: number;
}

export interface ParallaxTravel {
  /** Nonnegative camera travel towards negative and positive x, in world units. */
  leftTravel: number;
  rightTravel: number;
  /** Requested subject/background separation in CSS pixels, before safety caps. */
  targetGap: number;
  notice?: string;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Relative model depth is an artistic depth range, rather than physical metres. */
export function subjectZ(foregroundDepth: number): number {
  return clamp(finite(foregroundDepth, 0.5) * DEPTH_SPAN + 0.48, 0.78, 0.98);
}

/**
 * Choose camera travel from a visible pixel gap, then constrain each direction.
 * The DOM composition scales both layers by q, so their relative translation is
 * q * F * travel * (1 / (C - subjectZ) - 1 / (C - backgroundZ)).
 */
export function calculateParallax(options: ParallaxOptions): ParallaxTravel {
  const width = finite(options.width, 0);
  const height = finite(options.height, 0);
  const sourceWidth = finite(options.sourceWidth, 0);
  const zoom = finite(options.zoom, 0);
  if (width <= 0 || height <= 0 || sourceWidth <= 0 || zoom <= 0) {
    return {
      leftTravel: 0,
      rightTravel: 0,
      targetGap: 0,
      notice: "Spatial motion needs a visible preview.",
    };
  }

  const occupancy = clamp(
    finite(options.subjectStats?.occupancy ?? 0.3, 0.3),
    0,
    1,
  );
  // Large subjects need slightly less movement; small subjects get a small lift.
  const occupancyFactor = clamp(1 + (0.3 - occupancy) * 0.12, 0.94, 1.06);
  const minimumGap = options.touch ? 2.8 : 4;
  const maximumGap = options.touch ? 4 : 6;
  const baseGap = clamp(
    Math.min(width, height) * (options.touch ? 0.012 : 0.011),
    minimumGap,
    maximumGap,
  );
  const travelScale = Math.max(0, finite(options.travelScale, 1));
  const targetGap =
    clamp(baseGap * occupancyFactor, minimumGap, maximumGap) * travelScale;
  const focalPixels = height / (2 * Math.tan((FOV * Math.PI) / 360));
  const foregroundZ = clamp(finite(options.subjectReferenceZ ?? subjectZ(options.foregroundDepth),
    subjectZ(options.foregroundDepth)), 0, CAMERA_DISTANCE - 0.2);
  const cameraAdvance = clamp(finite(options.cameraAdvance ?? 0, 0), 0, 0.1);
  const cameraDistance = CAMERA_DISTANCE - cameraAdvance;
  const foregroundDistance = cameraDistance - foregroundZ;
  const backgroundZ = clamp(
    finite(options.backgroundZ ?? SKY_Z, SKY_Z),
    -CAMERA_DISTANCE,
    foregroundZ,
  );
  const gapPerWorldUnit =
    zoom *
    focalPixels *
    (1 / foregroundDistance - 1 / (cameraDistance - backgroundZ));
  const desiredTravel = gapPerWorldUnit > 0 ? targetGap / gapPerWorldUnit : 0;

  const padding =
    typeof options.paddingX === "number"
      ? { left: options.paddingX, right: options.paddingX }
      : options.paddingX;
  // Reserve 40% of the padded texture. The nearest layer is the conservative
  // projection for converting that source padding into safe camera movement.
  const nearestZ = clamp(finite(options.nearestZ ?? foregroundZ, foregroundZ),
    Math.max(foregroundZ, backgroundZ, DEPTH_SPAN), cameraDistance - 0.2);
  const nearDistance = cameraDistance - nearestZ;
  const paddingLimit = (pixels: number) =>
    (0.6 * width * Math.max(0, finite(pixels, 0)) * nearDistance) /
    (sourceWidth * focalPixels);
  let leftTravel = Math.min(0.12, desiredTravel, paddingLimit(padding.left));
  let rightTravel = Math.min(0.12, desiredTravel, paddingLimit(padding.right));

  const imageLeft = width * (0.5 + finite(options.shiftX, 0) - zoom / 2);
  const imageRight = imageLeft + width * zoom;
  const boundLeft = clamp(finite(options.subjectBounds[0], 0), 0, sourceWidth);
  const boundRight = clamp(
    finite(options.subjectBounds[2], sourceWidth),
    boundLeft,
    sourceWidth,
  );
  // Old results may predate edge statistics. Bounds at the source boundary are
  // the conservative fallback; new results use substantial edge alpha instead.
  const leftCut = options.subjectStats
    ? finite(options.subjectStats.leftEdgeFraction, 0) > 0
    : boundLeft <= sourceWidth * 0.001;
  const rightCut = options.subjectStats
    ? finite(options.subjectStats.rightEdgeFraction, 0) > 0
    : boundRight >= sourceWidth * 0.999;
  const travelForScreenMargin = (pixels: number) =>
    (Math.max(0, pixels) * nearDistance) / (zoom * focalPixels);

  // Negative camera x moves the subject right. A source cut on its left must
  // stay hidden; positive camera x has the corresponding right-edge limit.
  if (leftCut)
    leftTravel = Math.min(leftTravel, travelForScreenMargin(-imageLeft));
  if (rightCut)
    rightTravel = Math.min(
      rightTravel,
      travelForScreenMargin(imageRight - width),
    );

  // An intact source silhouette may enter and leave the composed viewport:
  // zooming it beyond the frame does not create a cut edge in the asset.
  // Bottom contact likewise does not restrict horizontal camera motion.
  leftTravel = leftTravel < 1e-8 ? 0 : Math.max(0, leftTravel);
  rightTravel = rightTravel < 1e-8 ? 0 : Math.max(0, rightTravel);
  const staticMotion = leftTravel === 0 && rightTravel === 0;
  const oneSided = (leftTravel === 0) !== (rightTravel === 0);
  const subtleMotion = Math.max(leftTravel, rightTravel) * gapPerWorldUnit < 2;
  let notice: string | undefined;
  if (travelScale > 0) {
    if (staticMotion) {
      notice = "This composition has no safe sideways room for motion.";
    } else if (oneSided) {
      notice = subtleMotion
        ? "Motion stays subtle and is limited to one side by this crop."
        : "Motion is limited to one side to keep the cropped edge hidden.";
    } else if (subtleMotion) {
      notice = "Motion is subtle at this composition.";
    }
  }
  return {
    leftTravel,
    rightTravel,
    targetGap,
    ...(notice ? { notice } : {}),
  };
}
