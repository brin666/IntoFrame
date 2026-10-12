import type { DepthResult, Result, RestyleResult, StyleId } from "./api";

export interface DemoSample {
  id: string;
  title: string;
  category: string;
  thumbnailUrl: string;
  defaultStyle: StyleId;
  source: { url: string; author: string; license: string; licenseUrl: string };
  result: Result;
  depth: DepthResult;
  styles: Record<StyleId, RestyleResult>;
}

/** Saved local inference results, served without invoking the GPU API. */
export async function loadDemoSamples(): Promise<DemoSample[]> {
  const response = await fetch("/samples/manifest.json");
  if (!response.ok) throw new Error("Sample photos could not be loaded.");
  const manifest = await response.json() as { version: number; samples: DemoSample[] };
  if (manifest.version !== 1 || !Array.isArray(manifest.samples))
    throw new Error("The sample photo manifest is unavailable.");
  for (const sample of manifest.samples) {
    if (!/^[a-z0-9-]+$/.test(sample.id) || !sample.result || !sample.depth ||
        sample.result.id !== `sample:${sample.id}` || sample.depth.jobId !== sample.result.id ||
        sample.result.width !== sample.depth.width || sample.result.height !== sample.depth.height ||
        !sample.styles[sample.defaultStyle])
      throw new Error("A sample photo has inconsistent image coordinates.");
  }
  return manifest.samples;
}
