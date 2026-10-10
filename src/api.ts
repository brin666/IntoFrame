export interface Result {
  id: string;
  width: number;
  height: number;
  sourceUrl: string;
  maskUrl: string;
  subjectUrl: string;
  subjectBounds: [number, number, number, number];
  composition: { scale: number; focusX: number; focusY: number };
  compositionNotice: string | null;
  model: string;
}

export interface Job {
  status: "processing" | "complete" | "failed";
  stage: string;
  result?: Result;
  error?: string;
}

export interface DepthResult {
  jobId: string;
  width: number;
  height: number;
  renderWidth: number;
  renderHeight: number;
  padding: { left: number; right: number; top: number; bottom: number };
  foregroundDepth: number;
  encoding: "uint8-png-near-white";
  depthUrl: string;
  renderDepthUrl: string;
  backgroundUrl: string;
  model: string;
  backgroundMethod: string;
}

export interface DepthJob {
  status: "processing" | "complete" | "failed";
  stage: string;
  result?: DepthResult;
  error?: string;
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.detail || `Request failed (${response.status}).`);
  return body as T;
}

export async function createJob(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/jobs", { method: "POST", body: form });
  return (await json<{ id: string }>(response)).id;
}

export async function getJob(id: string): Promise<Job> {
  return json<Job>(await fetch(`/api/jobs/${id}`));
}

export async function createDepth(id: string): Promise<void> {
  await json(
    await fetch("/api/depth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: id }),
    }),
  );
}

export async function getDepth(id: string): Promise<DepthJob> {
  return json<DepthJob>(await fetch(`/api/depth/${id}`));
}
