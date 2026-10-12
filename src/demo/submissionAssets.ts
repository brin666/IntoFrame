import { staticFile } from "remotion";
import type { DepthResult, Result, RestyleResult, StyleId } from "../api";
import { FILM_BAR_FRACTION } from "../frameComposition";
import type { PhotoRevealProps } from "../remotion/PhotoReveal";

export interface SampleSourceCredit {
  url: string;
  author: string;
  license: string;
  licenseUrl: string;
}

export interface SubmissionSample {
  id: string;
  title: string;
  category?: string;
  result: Result;
  depth: DepthResult;
  styles: Record<StyleId, RestyleResult>;
  defaultStyle: StyleId;
  thumbnailUrl: string;
  source: SampleSourceCredit;
}

export interface SubmissionManifest {
  version: 1;
  samples: SubmissionSample[];
}

export interface FilmShot {
  sampleId: string;
  sampleTitle: string;
  styleId: StyleId;
  styleLabel: string;
  input: PhotoRevealProps;
  compositeUrl: string;
  thumbnailUrl: string;
  sourceUrl: string;
  maskUrl: string;
  depthUrl: string;
  width: number;
  height: number;
  source: SampleSourceCredit;
}

export interface ArchitectureFilmCase {
  sampleId: string;
  title: string;
  defaultStyle: StyleId;
  source: SampleSourceCredit;
  width: number;
  height: number;
  sourceUrl: string;
  maskUrl: string;
  depthUrl: string;
  thumbnailUrl: string;
  styles: Record<StyleId, FilmShot>;
}

export interface SubmissionFilmProps extends Record<string, unknown> {
  architecture: ArchitectureFilmCase[];
  workflowVideoUrl: string;
  architectureVideoUrl: string;
}

const STYLE_IDS: StyleId[] = ["dreamy-pink", "golden-hour", "cinematic-night"];

const styleLabels: Record<StyleId, string> = {
  "dreamy-pink": "Dreamy Pink",
  "golden-hour": "Golden Hour",
  "cinematic-night": "Cinematic Night",
};

/**
 * Resolve only assets that belong to the public demo bundle. This also keeps
 * the same Vite/Remotion static-file URL working in the browser Player and CLI.
 */
export function resolveSubmissionAsset(input: string): string {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("A required demo asset path is missing.");
  }
  if (/^(https?:)?\/\//i.test(input) || input.includes("\\") || input.includes("?")) {
    throw new Error(`Demo assets must use a local public path: ${input}`);
  }

  const path = input.replace(/^\/+/, "");
  const parts = path.split("/");
  if (
    (parts[0] !== "samples" && parts[0] !== "demo") ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Demo assets must stay under /samples or /demo: ${input}`);
  }
  return staticFile(path);
}

function resolveSampleAsset(input: string, sampleId: string): string {
  const normalized = typeof input === "string" ? input.replace(/^\/+/, "") : "";
  if (!normalized.startsWith(`samples/${sampleId}/`)) {
    throw new Error(`Sample ${sampleId} assets must stay under /samples/${sampleId}/: ${input}`);
  }
  return resolveSubmissionAsset(normalized);
}

function isStyleId(value: unknown): value is StyleId {
  return typeof value === "string" && STYLE_IDS.includes(value as StyleId);
}

export function parseSubmissionManifest(value: unknown): SubmissionManifest {
  if (!value || typeof value !== "object") {
    throw new Error("The sample manifest is missing or invalid.");
  }
  const manifest = value as Partial<SubmissionManifest>;
  if (manifest.version !== 1 || !Array.isArray(manifest.samples)) {
    throw new Error("The sample manifest must use version 1 and include samples.");
  }
  if (!manifest.samples.length) {
    throw new Error("The sample manifest is still empty.");
  }

  const ids = new Set<string>();
  for (const value of manifest.samples as unknown[]) {
    if (!value || typeof value !== "object") {
      throw new Error("The sample manifest contains an incomplete sample.");
    }
    const sample = value as SubmissionSample;
    if (
      typeof sample.id !== "string" ||
      !/^[a-z0-9-]+$/i.test(sample.id) ||
      ids.has(sample.id) ||
      typeof sample.title !== "string" ||
      !sample.result ||
      !sample.depth ||
      !sample.styles ||
      !sample.source ||
      !isStyleId(sample.defaultStyle)
    ) {
      throw new Error("The sample manifest contains an incomplete or duplicate sample.");
    }
    ids.add(sample.id);
    if (
      !Number.isSafeInteger(sample.result.width) ||
      sample.result.width <= 0 ||
      !Number.isSafeInteger(sample.result.height) ||
      sample.result.height <= 0 ||
      sample.depth.width !== sample.result.width ||
      sample.depth.height !== sample.result.height
    ) {
      throw new Error(`${sample.title} has inconsistent native image dimensions.`);
    }
    if ([sample.source.url, sample.source.author, sample.source.license, sample.source.licenseUrl].some((part) => typeof part !== "string" || !part.trim())) {
      throw new Error(`${sample.title} is missing a source credit.`);
    }
    for (const styleId of STYLE_IDS) {
      const style = sample.styles[styleId];
      if (!style || style.style !== styleId || style.jobId !== sample.result.id) {
        throw new Error(`${sample.title} is missing its ${styleLabels[styleId]} style result.`);
      }
    }
  }

  return { version: 1, samples: manifest.samples as SubmissionSample[] };
}

function isArchitectureSample(sample: SubmissionSample): boolean {
  const category = sample.category?.trim().toLowerCase();
  return (
    category === "architecture" ||
    category === "building" ||
    category === "landmark" ||
    ["tower", "taipei", "flatiron", "qutub"].includes(sample.id.toLowerCase())
  );
}

function revealPose(sample: SubmissionSample): Pick<PhotoRevealProps, "zoom" | "shiftX" | "shiftY"> {
  const result = sample.result;
  const zoom = result.composition.scale;
  const horizontalLimit = (zoom - 1) / 2;
  const verticalLimit = horizontalLimit + FILM_BAR_FRACTION;
  const clamp = (value: number, low: number, high: number) =>
    Math.min(high, Math.max(low, value));
  const shiftX = clamp(-zoom * (result.composition.focusX - 0.5), -horizontalLimit, horizontalLimit);
  const baseYShift = clamp(
    result.subjectBounds[1] <= result.height * 0.04
      ? Math.max(
          -0.08 - zoom * (result.composition.focusY - 0.5),
          0.02 - (1 - zoom) / 2 - zoom * result.subjectBounds[1] / result.height,
        )
      : -0.08 - zoom * (result.composition.focusY - 0.5),
    -verticalLimit,
    verticalLimit,
  );
  const skyBottom = result.sky.bounds ? result.sky.bounds[3] / result.height : 1;
  const shiftY = result.sky.eligible
    ? clamp(Math.max(baseYShift, FILM_BAR_FRACTION + 0.15 - (1 - zoom) / 2 - zoom * skyBottom), -verticalLimit, verticalLimit)
    : baseYShift;
  return { zoom, shiftX, shiftY };
}

function createFilmShot(sample: SubmissionSample, styleId: StyleId): FilmShot {
  const style = sample.styles[styleId];
  if (!style) throw new Error(`${sample.title} has no ${styleLabels[styleId]} result.`);
  const { width, height } = sample.result;
  if (
    !Number.isSafeInteger(width) || width <= 0 ||
    !Number.isSafeInteger(height) || height <= 0 ||
    !Number.isFinite(sample.result.composition.scale) || sample.result.composition.scale <= 0
  ) {
    throw new Error(`${sample.title} has invalid native image dimensions or composition values.`);
  }
  const pose = revealPose(sample);
  const sourceUrl = resolveSampleAsset(sample.result.sourceUrl, sample.id);
  return {
    sampleId: sample.id,
    sampleTitle: sample.title,
    styleId,
    styleLabel: styleLabels[styleId],
    input: {
      sourceUrl,
      backgroundUrl: resolveSampleAsset(style.backgroundUrl, sample.id),
      subjectUrl: resolveSampleAsset(style.subjectUrl, sample.id),
      width,
      height,
      ...pose,
    },
    compositeUrl: resolveSampleAsset(style.compositeUrl, sample.id),
    thumbnailUrl: resolveSampleAsset(sample.thumbnailUrl, sample.id),
    sourceUrl,
    maskUrl: resolveSampleAsset(sample.result.maskUrl, sample.id),
    depthUrl: resolveSampleAsset(sample.depth.depthUrl, sample.id),
    width,
    height,
    source: sample.source,
  };
}

function createArchitectureCase(sample: SubmissionSample): ArchitectureFilmCase {
  // The sample metadata currently marks Taipei Golden Hour as its default,
  // but that variant has visible repeated bands; use a reviewed output instead.
  const defaultStyle = sample.id === "taipei" ? "dreamy-pink" : sample.defaultStyle;
  const styles = Object.fromEntries(
    STYLE_IDS.map((styleId) => [styleId, createFilmShot(sample, styleId)]),
  ) as Record<StyleId, FilmShot>;
  return {
    sampleId: sample.id,
    title: sample.title,
    defaultStyle,
    source: sample.source,
    width: sample.result.width,
    height: sample.result.height,
    sourceUrl: resolveSampleAsset(sample.result.sourceUrl, sample.id),
    maskUrl: resolveSampleAsset(sample.result.maskUrl, sample.id),
    depthUrl: resolveSampleAsset(sample.depth.depthUrl, sample.id),
    thumbnailUrl: resolveSampleAsset(sample.thumbnailUrl, sample.id),
    styles,
  };
}

export function createSubmissionFilmProps(manifest: SubmissionManifest): SubmissionFilmProps {
  const candidates = manifest.samples.filter(isArchitectureSample);
  const towerIndex = candidates.findIndex((sample) => sample.id === "tower");
  if (towerIndex > 0) {
    const [tower] = candidates.splice(towerIndex, 1);
    candidates.unshift(tower);
  }
  if (candidates.length < 3) {
    throw new Error("The architecture film needs at least three building examples.");
  }
  // The 150-second edit is timed for a hero plus up to three additional cases.
  const architecture = candidates.slice(0, 4).map(createArchitectureCase);
  return {
    architecture,
    workflowVideoUrl: resolveSubmissionAsset("demo/workflow.webm"),
    architectureVideoUrl: resolveSubmissionAsset("demo/architecture-interaction.webm"),
  };
}

export function getManifestSampleLink(sampleId: string): string {
  if (!/^[a-z0-9-]+$/i.test(sampleId)) {
    throw new Error("Sample IDs may contain only letters, digits, and dashes.");
  }
  return `/?sample=${encodeURIComponent(sampleId)}`;
}

export function getFilmAssetPaths(props: SubmissionFilmProps): string[] {
  const paths = new Set<string>([props.workflowVideoUrl, props.architectureVideoUrl]);
  for (const item of props.architecture) {
    paths.add(item.sourceUrl);
    paths.add(item.maskUrl);
    paths.add(item.depthUrl);
    paths.add(item.thumbnailUrl);
    for (const shot of Object.values(item.styles)) {
      paths.add(shot.input.backgroundUrl);
      paths.add(shot.input.subjectUrl);
      paths.add(shot.compositeUrl);
    }
  }
  return [...paths];
}
