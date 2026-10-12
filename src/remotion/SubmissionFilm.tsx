import { Img, OffthreadVideo, Sequence, interpolate, useCurrentFrame } from "remotion";
import type { CSSProperties } from "react";
import { PhotoReveal } from "./PhotoReveal";
import { FILM_BAR_FRACTION } from "../frameComposition";
import type { ArchitectureFilmCase, FilmShot, SubmissionFilmProps } from "../demo/submissionAssets";

export const SUBMISSION_FPS = 30;
export const SUBMISSION_DURATION_IN_FRAMES = 150 * SUBMISSION_FPS;

const ink = "#101113";
const paper = "#f1f1ed";
const muted = "#a3a39c";
const sand = "#e2d4b7";
const line = "#ffffff20";
const full: CSSProperties = { position: "absolute", inset: 0 };

const durations = {
  intro: 8 * SUBMISSION_FPS,
  workflow: 30 * SUBMISSION_FPS,
  hero: 18 * SUBMISSION_FPS,
  styles: 16 * SUBMISSION_FPS,
  montage: 24 * SUBMISSION_FPS,
  layers: 18 * SUBMISSION_FPS,
  interaction: 16 * SUBMISSION_FPS,
  closing: 20 * SUBMISSION_FPS,
} as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function BrandHeader({ label = "A PHOTO, REFRAMED" }: { label?: string }) {
  return (
    <div style={{ ...full, inset: "0 0 auto", height: 94, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 112px", borderBottom: `1px solid ${line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 25, height: 25, border: `2px solid ${sand}`, borderRadius: 7, transform: "rotate(-10deg)", position: "relative" }}>
          <span style={{ position: "absolute", width: 9, height: 9, borderTop: `2px solid ${sand}`, borderRight: `2px solid ${sand}`, left: 6, top: 6 }} />
        </div>
        <span style={{ fontSize: 23, fontWeight: 800, letterSpacing: "-0.06em", color: paper }}>IntoFrame</span>
      </div>
      <span style={{ color: muted, fontSize: 13, letterSpacing: "0.15em", textTransform: "uppercase" }}>{label}</span>
    </div>
  );
}

function ProgressFooter({ index, label, progress }: { index: string; label: string; progress: number }) {
  return (
    <div style={{ position: "absolute", inset: "auto 112px 0", height: 62, borderTop: `1px solid ${line}`, display: "flex", alignItems: "center", gap: 22, color: muted, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase" }}>
      <span style={{ color: sand }}>{index}</span>
      <span>{label}</span>
      <div style={{ marginLeft: "auto", width: 170, height: 2, background: "#ffffff20" }}>
        <div style={{ width: `${clamp01(progress) * 100}%`, height: "100%", background: sand }} />
      </div>
    </div>
  );
}

function SceneBackdrop() {
  return <div style={{ ...full, background: `radial-gradient(ellipse 72% 96% at 98% 33%, #252628 0%, transparent 62%), ${ink}` }} />;
}

function NativeImage({
  src,
  width,
  height,
  maxWidth,
  maxHeight,
  style,
}: {
  src: string;
  width: number;
  height: number;
  maxWidth: number;
  maxHeight: number;
  style?: CSSProperties;
}) {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error("A film image has invalid native dimensions.");
  }
  const scale = Math.min(maxWidth / width, maxHeight / height);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("Could not scale a native image into the film panel.");
  return (
    <Img
      src={src}
      width={width}
      height={height}
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width,
        height,
        maxWidth: "none",
        maxHeight: "none",
        transform: `translate(-50%, -50%) scale(${scale})`,
        transformOrigin: "center center",
        objectFit: "fill",
        display: "block",
        userSelect: "none",
        ...style,
      }}
    />
  );
}

const imagePanel: CSSProperties = {
  position: "absolute",
  left: 96,
  top: 142,
  width: 1234,
  height: 786,
  border: `1px solid ${line}`,
  borderRadius: 20,
  overflow: "hidden",
  background: "#0b0c0d",
  boxShadow: "0 34px 100px #0008",
};

function PhotoPanel({ shot }: { shot: FilmShot }) {
  const { width, height } = shot.input;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error(`Invalid native image dimensions for sample ${shot.sampleId}.`);
  }
  const nativeScale = Math.min(1190 / width, 720 / height);
  if (!Number.isFinite(nativeScale) || nativeScale <= 0) {
    throw new Error(`Could not scale sample ${shot.sampleId} into the film panel.`);
  }
  return (
    <div style={imagePanel}>
      <div style={{ ...full, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: "50%", top: "50%", width, height, transform: `translate(-50%, -50%) scale(${nativeScale})`, transformOrigin: "center center" }}>
          <PhotoReveal {...shot.input} />
        </div>
      </div>
      <div style={{ position: "absolute", inset: "auto 25px 19px", display: "flex", alignItems: "center", justifyContent: "space-between", pointerEvents: "none", color: "#e8e7e0b8", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        <span>{shot.sampleTitle}</span>
        <span>{shot.styleLabel}</span>
      </div>
    </div>
  );
}

function WipePanel({ shot, progress, rightLabel = "STYLED COMPOSITE" }: { shot: FilmShot; progress: number; rightLabel?: string }) {
  const amount = clamp01(progress) * 100;
  return (
    <div style={imagePanel}>
      <div style={{ ...full, overflow: "hidden" }}>
        <NativeImage src={shot.compositeUrl} width={shot.width} height={shot.height} maxWidth={1190} maxHeight={720} />
        <div style={{ ...full, clipPath: `inset(0 ${100 - amount}% 0 0)` }}>
          <NativeImage src={shot.sourceUrl} width={shot.width} height={shot.height} maxWidth={1190} maxHeight={720} />
        </div>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${amount}%`, width: 1, background: "#f1f1edcc", boxShadow: "0 0 14px #000a" }} />
        <div style={{ position: "absolute", left: 22, top: 20, padding: "9px 13px", background: "#101113d9", border: `1px solid ${line}`, borderRadius: 999, color: paper, fontSize: 11, letterSpacing: "0.14em" }}>ORIGINAL</div>
        <div style={{ position: "absolute", right: 22, top: 20, padding: "9px 13px", background: "#101113d9", border: `1px solid ${line}`, borderRadius: 999, color: paper, fontSize: 11, letterSpacing: "0.14em" }}>{rightLabel}</div>
      </div>
      <div style={{ position: "absolute", inset: "auto 25px 19px", display: "flex", justifyContent: "space-between", color: "#e8e7e0b8", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        <span>{shot.sampleTitle}</span><span>Same native frame</span>
      </div>
    </div>
  );
}

function ChapterCopy({ eyebrow, title, body, detail }: { eyebrow: string; title: string; body: string; detail?: string }) {
  return (
    <div style={{ position: "absolute", left: 1400, top: 215, width: 410 }}>
      <div style={{ color: sand, fontSize: 13, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 27 }}>{eyebrow}</div>
      <div style={{ color: paper, fontSize: 48, lineHeight: 1.08, fontWeight: 600, letterSpacing: "-0.055em", whiteSpace: "pre-line" }}>{title}</div>
      <div style={{ width: 60, height: 1, background: sand, margin: "31px 0 24px" }} />
      <div style={{ color: "#c2c2bc", fontSize: 19, lineHeight: 1.6, maxWidth: 390 }}>{body}</div>
      {detail && <div style={{ color: muted, fontSize: 13, lineHeight: 1.55, marginTop: 21 }}>{detail}</div>}
    </div>
  );
}

function IntroCard({ architecture }: { architecture: ArchitectureFilmCase[] }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 14, 225, 240], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const tiles = architecture.slice(0, 4);
  return (
    <div style={{ ...full, opacity }}>
      <SceneBackdrop />
      <BrandHeader label="A FILM ABOUT BUILDINGS, SKIES AND LAYERS" />
      <div style={{ position: "absolute", left: 150, top: 230, width: 870 }}>
        <div style={{ color: sand, fontSize: 14, letterSpacing: "0.24em", textTransform: "uppercase", marginBottom: 30 }}>FROM ONE PHOTO</div>
        <div style={{ color: paper, fontSize: 104, fontWeight: 600, lineHeight: 0.98, letterSpacing: "-0.075em" }}>IntoFrame</div>
        <div style={{ color: "#c5c4bd", fontSize: 34, marginTop: 27, letterSpacing: "-0.025em" }}>Make your photos come alive.</div>
        <div style={{ color: muted, fontSize: 15, marginTop: 64, letterSpacing: "0.12em", textTransform: "uppercase" }}>Real photos · One-time local processing</div>
      </div>
      <div style={{ position: "absolute", left: 1125, top: 178, width: 670, height: 700 }}>
        {tiles.map((item, index) => {
          const col = index % 2;
          const row = Math.floor(index / 2);
          const enter = interpolate(frame, [8 + index * 5, 38 + index * 5], [34, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div key={item.sampleId} style={{ position: "absolute", left: col * 340, top: row * 340, width: 310, height: 300, overflow: "hidden", border: `1px solid ${line}`, borderRadius: 17, background: "#0b0c0d", transform: `translateY(${enter}px)`, opacity: interpolate(frame, [8 + index * 5, 30 + index * 5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
              <div style={{ position: "absolute", inset: 12, overflow: "hidden" }}>
                <NativeImage src={item.sourceUrl} width={item.width} height={item.height} maxWidth={284} maxHeight={263} />
              </div>
              <div style={{ position: "absolute", inset: "auto 14px 13px", color: "#e6e4de", fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", textShadow: "0 2px 8px #000" }}>{item.title}</div>
            </div>
          );
        })}
      </div>
      <ProgressFooter index="00" label="ONE PHOTO, A NEW FRAME" progress={frame / (durations.intro - 1)} />
    </div>
  );
}

function WorkflowChapter({ videoUrl }: { videoUrl: string }) {
  const frame = useCurrentFrame();
  const steps = ["Upload a photo", "Run local processing", "Compare the result", "Download the frame"];
  const active = Math.min(steps.length - 1, Math.floor((frame / durations.workflow) * steps.length));
  return (
    <div style={full}>
      <SceneBackdrop />
      <BrandHeader label="THE ACTUAL BROWSER WORKFLOW" />
      <div style={{ ...imagePanel, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <OffthreadVideo
          src={videoUrl}
          muted
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", background: "#08090a" }}
        />
      </div>
      <div style={{ position: "absolute", left: 1390, top: 192, width: 420 }}>
        <div style={{ color: sand, fontSize: 13, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 25 }}>01 — FROM INPUT TO EXPORT</div>
        <div style={{ color: paper, fontSize: 43, lineHeight: 1.1, fontWeight: 600, letterSpacing: "-0.055em" }}>A real run,<br />captured in the browser.</div>
        <div style={{ width: 60, height: 1, background: sand, margin: "28px 0 20px" }} />
        <div style={{ display: "grid", gap: 13 }}>
          {steps.map((step, index) => (
            <div key={step} style={{ display: "flex", alignItems: "center", gap: 13, color: index <= active ? paper : muted, fontSize: 16, lineHeight: 1.35 }}>
              <span style={{ width: 24, height: 24, display: "grid", placeItems: "center", border: `1px solid ${index === active ? sand : line}`, borderRadius: "50%", color: index === active ? sand : muted, fontSize: 11 }}>{String(index + 1).padStart(2, "0")}</span>
              {step}
            </div>
          ))}
        </div>
        <div style={{ color: muted, fontSize: 13, lineHeight: 1.55, marginTop: 30 }}>Real browser recording · processing wait shortened.</div>
      </div>
      <ProgressFooter index="01" label="REAL SCREEN RECORDING · PROCESSING WAIT SHORTENED" progress={frame / (durations.workflow - 1)} />
    </div>
  );
}

function HeroChapter({ item }: { item: ArchitectureFilmCase }) {
  const frame = useCurrentFrame();
  const shot = item.styles[item.defaultStyle];
  const stage = frame < 180 ? 0 : frame < 360 ? 1 : 2;
  return (
    <div style={full}>
      <SceneBackdrop />
      <BrandHeader label="A PHOTO, A NEW FRAME" />
      {stage === 1 ? <WipePanel shot={shot} progress={interpolate(frame, [180, 359], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} /> : <PhotoPanel shot={shot} />}
      {stage === 0 && <ChapterCopy eyebrow="02 — ORIGINAL → STYLE → BARS" title={"Start with the\nsource photo."} body="The six-second planar reveal brings in the generated sky, keeps the cutout above it, then settles the cinematic bars." detail="This is a 2D layer composite, not a 3D reconstruction." />}
      {stage === 1 && <ChapterCopy eyebrow="02 — THE RESULT" title={"Compare the\nsame frame."} body="A moving wipe compares the original photo with the selected, precomputed composite." detail="The source crop and native proportions stay intact." />}
      {stage === 2 && <ChapterCopy eyebrow="02 — THE LAYERS" title={"The subject can\nclear the bars."} body="The isolated foreground sits above the bars while the styled sky remains behind it." detail="Shallow compositing · bounded 2.5D preview." />}
      <ProgressFooter index="02" label={`${item.title.toUpperCase()} · ${shot.styleLabel.toUpperCase()}`} progress={frame / (durations.hero - 1)} />
    </div>
  );
}

function StyleComparison({ item }: { item: ArchitectureFilmCase }) {
  const frame = useCurrentFrame();
  const ordered = ["dreamy-pink", "golden-hour", "cinematic-night"] as const;
  const phaseLength = durations.styles / ordered.length;
  const phaseFrame = frame % phaseLength;
  const active = Math.floor(frame / phaseLength) % ordered.length;
  const next = (active + 1) % ordered.length;
  const fadeFrames = Math.round(1.3 * SUBMISSION_FPS);
  const blend = interpolate(
    phaseFrame,
    [phaseLength - fadeFrames, phaseLength - 1],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <div style={full}>
      <SceneBackdrop />
      <BrandHeader label="THREE STYLES, ONE SOURCE" />
      <div style={imagePanel}>
        {[active, next].map((index, layer) => {
          const styleId = ordered[index];
          const shot = item.styles[styleId];
          return <NativeImage key={`${styleId}-${layer}`} src={shot.compositeUrl} width={shot.width} height={shot.height} maxWidth={1190} maxHeight={720} style={{ opacity: layer === 0 ? 1 : blend }} />;
        })}
        <div style={{ position: "absolute", inset: "auto 25px 19px", display: "flex", justifyContent: "space-between", color: "#e8e7e0b8", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          <span>{item.title}</span><span>Precomputed style outputs</span>
        </div>
      </div>
      <div style={{ position: "absolute", left: 1400, top: 215, width: 410 }}>
        <div style={{ color: sand, fontSize: 13, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 27 }}>03 — SAME SOURCE PHOTO</div>
        <div style={{ color: paper, fontSize: 47, lineHeight: 1.08, fontWeight: 600, letterSpacing: "-0.055em" }}>One building.<br />Three treatments.</div>
        <div style={{ width: 60, height: 1, background: sand, margin: "31px 0 24px" }} />
        <div style={{ color: "#c2c2bc", fontSize: 18, lineHeight: 1.6 }}>The same source photo and foreground cutout, shown with three saved sky styles.</div>
        <div style={{ marginTop: 34, display: "grid", gap: 18 }}>
          {ordered.map((styleId, index) => (
            <div key={styleId} style={{ display: "flex", alignItems: "center", gap: 12, opacity: index === active ? 1 : 0.5, transition: "opacity 120ms linear" }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: index === active ? sand : "#6b6b65" }} />
              <span style={{ color: index === active ? paper : muted, fontSize: 16, letterSpacing: "0.02em" }}>{item.styles[styleId].styleLabel}</span>
            </div>
          ))}
        </div>
      </div>
      <ProgressFooter index="03" label={`${item.title.toUpperCase()} · THREE PRECOMPUTED STYLES`} progress={frame / (durations.styles - 1)} />
    </div>
  );
}

function ArchitectureCaseChapter({ item, index, duration }: { item: ArchitectureFilmCase; index: number; duration: number }) {
  const frame = useCurrentFrame();
  const shot = item.styles[item.defaultStyle];
  const reveal = frame < 180;
  return (
    <div style={full}>
      <SceneBackdrop />
      <BrandHeader label="MORE ARCHITECTURE, SAME APPROACH" />
      {reveal ? <PhotoPanel shot={shot} /> : <WipePanel shot={shot} progress={interpolate(frame, [180, Math.max(181, duration - 1)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />}
      <ChapterCopy
        eyebrow={`04 — BUILDING ${String(index).padStart(2, "0")}`}
        title={item.title}
        body={reveal ? "The reveal uses the sample’s native photo proportions and its selected style layers." : "The wipe exposes the original beside the actual precomputed result."}
        detail={`${shot.styleLabel} · source attribution in closing credits.`}
      />
      <ProgressFooter index="04" label={`${item.title.toUpperCase()} · SOURCE AND COMPOSITE`} progress={frame / Math.max(1, duration - 1)} />
    </div>
  );
}

function ArchitectureMontage({ architecture }: { architecture: ArchitectureFilmCase[] }) {
  const cases = architecture.slice(1, 4);
  const each = Math.floor(durations.montage / cases.length);
  return (
    <div style={full}>
      {cases.map((item, index) => (
        <Sequence key={item.sampleId} from={index * each} durationInFrames={each}>
          <ArchitectureCaseChapter item={item} index={index + 1} duration={each} />
        </Sequence>
      ))}
    </div>
  );
}

function LayerPanel({ src, width, height, label, caption, enter, kind }: {
  src: string;
  width: number;
  height: number;
  label: string;
  caption: string;
  enter: number;
  kind: "photo" | "mask" | "depth";
}) {
  const imageTop = 286;
  const imageHeight = 514;
  const columns = [110, 700, 1290];
  const left = columns[kind === "photo" ? 0 : kind === "mask" ? 1 : 2];
  const opacity = interpolate(enter, [0, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const offset = interpolate(enter, [0, 18], [25, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left, top: imageTop, width: 520, height: 640, opacity, transform: `translateY(${offset}px)` }}>
      <div style={{ color: sand, fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", margin: "0 0 16px 8px" }}>{label}</div>
      <div style={{ position: "absolute", left: 0, top: 30, width: 500, height: imageHeight, border: `1px solid ${line}`, borderRadius: 16, overflow: "hidden", background: kind === "mask" ? "#303132" : "#090a0b" }}>
        <NativeImage src={src} width={width} height={height} maxWidth={470} maxHeight={imageHeight - 25} />
      </div>
      <div style={{ position: "absolute", left: 8, top: 558, width: 480, color: "#c2c2bc", fontSize: 15, lineHeight: 1.5 }}>{caption}</div>
    </div>
  );
}

function ExplodedLayerIllustration({ item, shot, frame }: { item: ArchitectureFilmCase; shot: FilmShot; frame: number }) {
  const localFrame = frame - 270;
  const spread = interpolate(localFrame, [12, 62, 165, 222], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeIn = interpolate(localFrame, [0, 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = Math.min(400 / item.width, 430 / item.height);
  const canvasWidth = item.width * scale;
  const centerX = 250;
  const centerY = 285;
  const separation = 58 * spread;
  const labels: Record<string, number> = {
    subject: centerY - 58 - 10,
    bars: centerY - 10,
    background: centerY + 58 - 10,
  };
  const zoom = shot.input.zoom;
  const imageRect = {
    left: item.width * ((1 - zoom) / 2 + shot.input.shiftX),
    top: item.height * ((1 - zoom) / 2 + shot.input.shiftY),
    width: item.width * zoom,
    height: item.height * zoom,
  };
  const rows = [
    { id: "background", name: "STYLED BACKGROUND LAYER", url: shot.input.backgroundUrl, offset: separation },
    { id: "bars", name: "CINEMATIC BARS", offset: 0 },
    { id: "subject", name: "ALPHA SUBJECT CUTOUT", url: shot.input.subjectUrl, offset: -separation },
  ] as const;
  const labelOpacity = interpolate(localFrame, [35, 55], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const checker: CSSProperties = {
    backgroundColor: "#28292b",
    backgroundImage: "linear-gradient(45deg, #3b3c3f 25%, transparent 25%), linear-gradient(-45deg, #3b3c3f 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3b3c3f 75%), linear-gradient(-45deg, transparent 75%, #3b3c3f 75%)",
    backgroundSize: "22px 22px",
    backgroundPosition: "0 0, 0 11px, 11px -11px, -11px 0px",
  };

  return (
    <>
      <div style={{ position: "absolute", left: 110, top: 235, width: 750, height: 690, border: `1px solid ${line}`, borderRadius: 20, overflow: "hidden", background: "#08090a", boxShadow: "0 34px 100px #0008", opacity: fadeIn }}>
        <div style={{ position: "absolute", left: 25, top: 20, color: sand, fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase" }}>SAVED NATIVE COMPOSITE</div>
        <div style={{ position: "absolute", inset: "60px 20px", overflow: "hidden" }}>
          <NativeImage src={shot.compositeUrl} width={item.width} height={item.height} maxWidth={700} maxHeight={570} />
        </div>
        <div style={{ position: "absolute", left: 25, bottom: 20, color: muted, fontSize: 12 }}>The styled RGB composite in its original image coordinates.</div>
      </div>
      <div style={{ ...imagePanel, left: 920, top: 235, width: 900, height: 690, opacity: fadeIn }}>
        <div style={{ position: "absolute", left: 25, top: 20, color: sand, fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase" }}>2D EXPLODED LAYER VIEW · SAME NATIVE COORDINATES</div>
        <div style={{ position: "absolute", left: 20, right: 20, top: 60, bottom: 60, overflow: "hidden", ...checker }}>
        {rows.map((row) => (
          <div
            key={row.id}
            style={{
              position: "absolute",
              left: centerX,
              top: centerY + row.offset,
              width: item.width,
              height: item.height,
              transform: `translate(-50%, -50%) scale(${scale})`,
              transformOrigin: "center center",
            }}>
            {row.id === "bars" ? (
              <>
                <div style={{ position: "absolute", inset: "0 0 auto", height: `${FILM_BAR_FRACTION * 100}%`, background: "#08090a" }} />
                <div style={{ position: "absolute", inset: "auto 0 0", height: `${FILM_BAR_FRACTION * 100}%`, background: "#08090a" }} />
              </>
            ) : (
              <Img src={row.url} width={item.width} height={item.height} style={{ position: "absolute", left: imageRect.left, top: imageRect.top, width: imageRect.width, height: imageRect.height, maxWidth: "none", maxHeight: "none", display: "block" }} />
            )}
          </div>
        ))}
        <svg aria-hidden="true" width="100%" height="100%" viewBox="0 0 860 570" style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}>
          {rows.map((row) => {
            const sourceX = centerX + canvasWidth / 2 + 6;
            const sourceY = centerY + row.offset;
            const labelY = labels[row.id] + 11;
            return <path key={`${row.id}-leader`} d={`M ${sourceX} ${sourceY} H 470 L 520 ${labelY}`} fill="none" stroke={sand} strokeOpacity="0.48" strokeWidth="1" />;
          })}
        </svg>
        {rows.map((row) => (
          <div key={`${row.id}-label`} style={{ position: "absolute", left: 535, top: labels[row.id], width: 280, color: paper, opacity: labelOpacity, fontSize: 10, lineHeight: 1.4, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            <span style={{ display: "block", width: 42, height: 1, background: sand, marginBottom: 7 }} />
            {row.name}
          </div>
        ))}
        </div>
        <div style={{ position: "absolute", left: 25, bottom: 20, color: muted, fontSize: 12, letterSpacing: "0.05em" }}>Vertical spacing is illustrative; layers are aligned in one 2D image plane.</div>
      </div>
    </>
  );
}

function LayerBreakdown({ item }: { item: ArchitectureFilmCase }) {
  const frame = useCurrentFrame();
  const shot = item.styles[item.defaultStyle];
  const exploded = frame >= 270;
  const panelsOpacity = interpolate(frame, [252, 278], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={full}>
      <SceneBackdrop />
      <BrandHeader label="INSIDE THE IMAGE" />
      <div style={{ position: "absolute", left: 110, top: 140, color: paper, fontSize: 49, lineHeight: 1.05, fontWeight: 600, letterSpacing: "-0.06em" }}>{exploded ? "Split and rejoin the 2D layers." : "Three inputs, one native frame."}</div>
      <div style={{ opacity: panelsOpacity }}>
        <LayerPanel src={item.sourceUrl} width={item.width} height={item.height} kind="photo" label="01 · RGB SOURCE" caption="The original pixels and crop." enter={frame - 0} />
        <LayerPanel src={item.maskUrl} width={item.width} height={item.height} kind="mask" label="02 · FOREGROUND MASK" caption="The subject selection used for the cutout." enter={frame - 42} />
        <LayerPanel src={item.depthUrl} width={item.width} height={item.height} kind="depth" label="03 · RELATIVE DEPTH" caption="Near is light; far is dark. Model-relative, not meters." enter={frame - 84} />
        <div style={{ position: "absolute", left: 1298, top: 920, width: 482 }}>
          <div style={{ height: 7, borderRadius: 4, background: "linear-gradient(90deg, #f1f1ed 0%, #8e8e8b 52%, #111213 100%)" }} />
          <div style={{ display: "flex", justifyContent: "space-between", color: muted, fontSize: 11, letterSpacing: "0.12em", marginTop: 8 }}><span>NEAR · LIGHT</span><span>FAR · DARK</span></div>
        </div>
      </div>
      {exploded && <ExplodedLayerIllustration item={item} shot={shot} frame={frame} />}
      <ProgressFooter index="05" label={`${item.title.toUpperCase()} · NATIVE IMAGE LAYERS`} progress={frame / (durations.layers - 1)} />
    </div>
  );
}

function InteractionChapter({ videoUrl }: { videoUrl: string }) {
  const frame = useCurrentFrame();
  return (
    <div style={full}>
      <SceneBackdrop />
      <BrandHeader label="REAL ARCHITECTURE INTERACTION" />
      <div style={{ ...imagePanel, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <OffthreadVideo src={videoUrl} muted style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", background: "#08090a" }} />
      </div>
      <ChapterCopy
        eyebrow="06 — TWO BUILDINGS, REAL DRAG"
        title={"A little depth,\nkept in bounds."}
        body="Watch the actual standalone app as the shallow preview responds to a drag across two architecture examples."
        detail="Relative depth · bounded 2.5D parallax."
      />
      <ProgressFooter index="06" label="REAL UI · REAL INPUT · LOCAL DEPTH ESTIMATE" progress={frame / (durations.interaction - 1)} />
    </div>
  );
}

function CreditLine({ item }: { item: ArchitectureFilmCase }) {
  const label = item.sampleId === "tower" ? "Tower photo" : `${item.title} photo`;
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ color: "#d2d1ca", fontSize: 15, lineHeight: 1.45 }}>{label}: {item.source.author} · {item.source.license}</div>
      <div style={{ color: muted, fontSize: 10, lineHeight: 1.45, overflowWrap: "anywhere" }}>Source: {item.source.url}</div>
      <div style={{ color: muted, fontSize: 10, lineHeight: 1.45, overflowWrap: "anywhere" }}>License: {item.source.licenseUrl}</div>
    </div>
  );
}

function ClosingCard({ props }: { props: SubmissionFilmProps }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 18, durations.closing - 15, durations.closing - 1], [0, 1, 1, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cases = props.architecture;
  const slot = durations.closing / cases.length;
  const phaseFrame = frame % slot;
  const active = Math.floor(frame / slot) % cases.length;
  const next = (active + 1) % cases.length;
  const fadeFrames = Math.round(1.3 * SUBMISSION_FPS);
  const blend = interpolate(
    phaseFrame,
    [slot - fadeFrames, slot - 1],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const activeCase = cases[active];
  const nextCase = cases[next];
  return (
    <div style={{ ...full, opacity }}>
      <SceneBackdrop />
      <BrandHeader label="BUILD THE FRAME" />
      <div style={{ position: "absolute", left: 120, top: 142, width: 1120 }}>
        <div style={{ color: sand, fontSize: 13, letterSpacing: "0.22em", textTransform: "uppercase" }}>INTOFRAME</div>
        <div style={{ color: paper, fontSize: 64, lineHeight: 1.03, fontWeight: 600, letterSpacing: "-0.065em", marginTop: 16 }}>Make your photos<br />come alive.</div>
        <div style={{ color: "#c2c2bc", fontSize: 19, marginTop: 17 }}>github.com/brin666/IntoFrame</div>
        <div style={{ height: 1, width: 1000, background: line, margin: "25px 0 16px" }} />
        <div style={{ color: sand, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 12 }}>Architecture photo credits and licenses</div>
        {cases.map((item) => <CreditLine key={item.sampleId} item={item} />)}
        <div style={{ color: muted, fontSize: 12, marginTop: 9 }}>Styles and layers in this film use the credited, precomputed sample assets.</div>
      </div>
      <div style={{ position: "absolute", left: 1365, top: 255, width: 430, height: 560, border: `1px solid ${line}`, borderRadius: 20, overflow: "hidden", background: "#08090a" }}>
        <div style={{ ...full, background: "#08090a" }}>
          <NativeImage src={activeCase.styles[activeCase.defaultStyle].compositeUrl} width={activeCase.width} height={activeCase.height} maxWidth={390} maxHeight={520} />
        </div>
        <div style={{ ...full, background: "#08090a", opacity: blend }}>
          <NativeImage src={nextCase.styles[nextCase.defaultStyle].compositeUrl} width={nextCase.width} height={nextCase.height} maxWidth={390} maxHeight={520} />
        </div>
        <div style={{ position: "absolute", inset: "auto 18px 18px", display: "flex", justifyContent: "space-between", color: paper, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", textShadow: "0 2px 9px #000" }}>
          <span>{cases[active]?.title}</span><span>{String(active + 1).padStart(2, "0")} / {String(cases.length).padStart(2, "0")}</span>
        </div>
      </div>
      <ProgressFooter index="07" label="INTOFRAME · 2026" progress={frame / (durations.closing - 1)} />
    </div>
  );
}

/** A 150-second architecture film built from real local samples and recordings. */
export function SubmissionFilm(props: SubmissionFilmProps) {
  if (props.architecture.length < 3) throw new Error("The architecture film needs at least three building examples.");
  const starts = [
    0,
    durations.intro,
    durations.intro + durations.workflow,
    durations.intro + durations.workflow + durations.hero,
    durations.intro + durations.workflow + durations.hero + durations.styles,
    durations.intro + durations.workflow + durations.hero + durations.styles + durations.montage,
    durations.intro + durations.workflow + durations.hero + durations.styles + durations.montage + durations.layers,
    durations.intro + durations.workflow + durations.hero + durations.styles + durations.montage + durations.layers + durations.interaction,
  ];

  return (
    <div style={{ ...full, background: ink, color: paper, fontFamily: "Manrope, 'DM Sans', Arial, sans-serif", overflow: "hidden" }}>
      <Sequence from={starts[0]} durationInFrames={durations.intro}><IntroCard architecture={props.architecture} /></Sequence>
      <Sequence from={starts[1]} durationInFrames={durations.workflow}><WorkflowChapter videoUrl={props.workflowVideoUrl} /></Sequence>
      <Sequence from={starts[2]} durationInFrames={durations.hero}><HeroChapter item={props.architecture[0]} /></Sequence>
      <Sequence from={starts[3]} durationInFrames={durations.styles}><StyleComparison item={props.architecture[0]} /></Sequence>
      <Sequence from={starts[4]} durationInFrames={durations.montage}><ArchitectureMontage architecture={props.architecture} /></Sequence>
      <Sequence from={starts[5]} durationInFrames={durations.layers}><LayerBreakdown item={props.architecture[0]} /></Sequence>
      <Sequence from={starts[6]} durationInFrames={durations.interaction}><InteractionChapter videoUrl={props.architectureVideoUrl} /></Sequence>
      <Sequence from={starts[7]} durationInFrames={durations.closing}><ClosingCard props={props} /></Sequence>
    </div>
  );
}
