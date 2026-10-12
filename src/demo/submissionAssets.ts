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
  thumbnailUrl: string;
  source: SampleSourceCredit;
}

export interface SubmissionFilmProps extends Record<string, unknown> {
  pink: FilmShot;
  blueHour: FilmShot;
  portrait: FilmShot;
  dog: FilmShot;
  rocket: FilmShot;
  interactionVideoUrl: string;
}

const styleLabels: Record<StyleId, string> = {
  "dreamy-pink": "Dreamy Pink",
  "golden-hour": "Golden Hour",
  "cinematic-night": "Blue Hour",
};

/**
 * Resolve only assets that belong to the public demo bundle. Keeping this
 * guard in front of Remotion's staticFile() prevents manifest URLs from
 * escaping public/samples or public/demo in the browser and render pipeline.
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

export function parseSubmissionManifest(value: unknown): SubmissionManifest {
  if (!value || typeof value !== "object") {
    throw new Error("The sample manifest is missing or invalid.");
  }
  const manifest = value as Partial<SubmissionManifest>;
  if (manifest.version !== 1 || !Array.isArray(manifest.samples)) {
    throw new Error("The sample manifest must use version 1 and include samples.");
  }

  const samples = manifest.samples as SubmissionSample[];
  if (!samples.length) {
    throw new Error("The sample manifest is still empty.");
  }
  for (const sample of samples) {
    if (
      !sample ||
      typeof sample.id !== "string" ||
      !/^[a-z0-9-]+$/i.test(sample.id) ||
      typeof sample.title !== "string" ||
      !sample.result ||
      !sample.depth ||
      !sample.styles ||
      !sample.source
    ) {
      throw new Error("The sample manifest contains an incomplete sample.");
    }
  }
  return { version: 1, samples };
}

function getSample(manifest: SubmissionManifest, id: string): SubmissionSample | undefined {
  return manifest.samples.find((sample) => sample.id === id);
}

function chooseFeatureSample(manifest: SubmissionManifest): SubmissionSample {
  const feature = getSample(manifest, "tower") ?? getSample(manifest, "rocket");
  if (!feature) {
    throw new Error("The demo needs a tower sample, or a rocket fallback.");
  }
  return feature;
}

function requireSample(manifest: SubmissionManifest, id: string): SubmissionSample {
  const sample = getSample(manifest, id);
  if (!sample) throw new Error(`The ${id} sample is missing from the manifest.`);
  return sample;
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

export function createFilmShot(sample: SubmissionSample, styleId: StyleId): FilmShot {
  const style = sample.styles[styleId];
  if (!style) throw new Error(`${sample.title} has no ${styleLabels[styleId]} result.`);
  for (const dimension of [sample.result.width, sample.result.height]) {
    if (!Number.isSafeInteger(dimension) || dimension <= 0) {
      throw new Error(`${sample.title} has invalid native image dimensions.`);
    }
  }
  const pose = revealPose(sample);
  return {
    sampleId: sample.id,
    sampleTitle: sample.title,
    styleId,
    styleLabel: styleLabels[styleId],
    input: {
      sourceUrl: resolveSampleAsset(sample.result.sourceUrl, sample.id),
      backgroundUrl: resolveSampleAsset(style.backgroundUrl, sample.id),
      subjectUrl: resolveSampleAsset(style.subjectUrl, sample.id),
      width: sample.result.width,
      height: sample.result.height,
      ...pose,
    },
    thumbnailUrl: resolveSampleAsset(sample.thumbnailUrl, sample.id),
    source: sample.source,
  };
}

export function createSubmissionFilmProps(
  manifest: SubmissionManifest,
): SubmissionFilmProps {
  const feature = chooseFeatureSample(manifest);
  const portrait = requireSample(manifest, "portrait");
  const dog = requireSample(manifest, "dog");
  const rocket = requireSample(manifest, "rocket");
  return {
    pink: createFilmShot(feature, "dreamy-pink"),
    // Keep one source photo for both style chapters to make the comparison clear.
    blueHour: createFilmShot(portrait, "cinematic-night"),
    portrait: createFilmShot(portrait, "golden-hour"),
    dog: createFilmShot(dog, "dreamy-pink"),
    rocket: createFilmShot(rocket, "golden-hour"),
    interactionVideoUrl: resolveSubmissionAsset("demo/interaction.webm"),
  };
}

export function getManifestSampleLink(sampleId: string): string {
  if (!/^[a-z0-9-]+$/i.test(sampleId)) {
    throw new Error("Sample IDs may contain only letters, digits, and dashes.");
  }
  return `/?sample=${encodeURIComponent(sampleId)}`;
}

export function getFilmAssetPaths(props: SubmissionFilmProps): string[] {
  const shots = [props.pink, props.blueHour, props.portrait, props.dog, props.rocket];
  return [
    ...shots.flatMap((shot) => [
      shot.input.sourceUrl,
      shot.input.backgroundUrl,
      shot.input.subjectUrl,
      shot.thumbnailUrl,
    ]),
    props.interactionVideoUrl,
  ];
}
