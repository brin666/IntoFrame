import type { Result } from "./api";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load an export layer."));
    image.src = url;
  });
}

/** Paint the same centered crop and 13% film bars as the still preview. */
export async function exportFrame(
  result: Result,
  backgroundUrl: string,
  zoom: number,
  xShift: number,
  yShift: number,
  name: string,
): Promise<void> {
  const [background, subject] = await Promise.all([
    loadImage(backgroundUrl),
    loadImage(result.subjectUrl),
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = result.width;
  canvas.height = result.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("PNG export is unavailable in this browser.");
  const width = result.width;
  const height = result.height;
  const left = width * ((1 - zoom) / 2 + xShift);
  const top = height * ((1 - zoom) / 2 + yShift);
  context.fillStyle = "#0b0c0d";
  context.fillRect(0, 0, width, height);
  context.save();
  context.beginPath();
  context.rect(0, height * 0.13, width, height * 0.74);
  context.clip();
  context.drawImage(background, left, top, width * zoom, height * zoom);
  context.restore();
  context.drawImage(subject, left, top, width * zoom, height * zoom);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encoding failed.")), "image/png");
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]/gi, "-") || "IntoFrame"}-IntoFrame.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
