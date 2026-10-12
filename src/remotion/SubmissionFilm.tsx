import { OffthreadVideo, Sequence, interpolate, useCurrentFrame } from "remotion";
import type { CSSProperties } from "react";
import { PhotoReveal } from "./PhotoReveal";
import type { FilmShot, SubmissionFilmProps } from "../demo/submissionAssets";

export const SUBMISSION_FPS = 30;
export const SUBMISSION_DURATION_IN_FRAMES = 63 * SUBMISSION_FPS;

const ink = "#101113";
const paper = "#f1f1ed";
const muted = "#a3a39c";
const sand = "#e2d4b7";
const line = "#ffffff20";

const full: CSSProperties = { position: "absolute", inset: 0 };

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
        <div style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%`, height: "100%", background: sand }} />
      </div>
    </div>
  );
}

function SceneBackdrop() {
  return (
    <div style={{ ...full, background: `radial-gradient(ellipse 72% 96% at 98% 33%, #252628 0%, transparent 62%), ${ink}` }} />
  );
}

function PhotoPanel({ shot }: { shot: FilmShot }) {
  const { width, height } = shot.input;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error(`Invalid native image dimensions for sample ${shot.sampleId}.`);
  }
  const nativeScale = Math.min(1200 / width, 730 / height);
  if (!Number.isFinite(nativeScale) || nativeScale <= 0) {
    throw new Error(`Could not scale sample ${shot.sampleId} into the film panel.`);
  }
  return (
    <div style={{ position: "absolute", left: 100, top: 154, width: 1230, height: 770, border: `1px solid ${line}`, borderRadius: 20, overflow: "hidden", background: "#0b0c0d", boxShadow: "0 34px 100px #0008" }}>
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

function SourceLine({ shot }: { shot: FilmShot }) {
  const label = shot.sampleId === "tower"
    ? `Tower photo: ${shot.source.author} · ${shot.source.license}`
    : `Photo: ${shot.source.author} · ${shot.source.license}`;
  return <div style={{ color: muted, fontSize: 13, lineHeight: 1.55 }}>{label}</div>;
}

function ShotCopy({
  shot,
  eyebrow,
  title,
  body,
}: {
  shot: FilmShot;
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div style={{ position: "absolute", left: 1400, top: 228, width: 410 }}>
      <div style={{ color: sand, fontSize: 13, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 27 }}>{eyebrow}</div>
      <div style={{ color: paper, fontSize: 51, lineHeight: 1.08, fontWeight: 600, letterSpacing: "-0.055em", whiteSpace: "pre-line" }}>{title}</div>
      <div style={{ width: 60, height: 1, background: sand, margin: "31px 0 24px" }} />
      <div style={{ color: "#c2c2bc", fontSize: 19, lineHeight: 1.6, maxWidth: 385 }}>{body}</div>
      <div style={{ color: muted, fontSize: 12, letterSpacing: "0.13em", textTransform: "uppercase", marginTop: 29 }}>{shot.styleLabel} · {shot.sampleTitle}</div>
      <div style={{ marginTop: 13 }}><SourceLine shot={shot} /></div>
    </div>
  );
}

function PhotoChapter({
  shot,
  index,
  eyebrow,
  title,
  body,
  footer,
  duration,
}: {
  shot: FilmShot;
  index: string;
  eyebrow: string;
  title: string;
  body: string;
  footer: string;
  duration: number;
}) {
  const frame = useCurrentFrame();
  return (
    <div style={full}>
      <SceneBackdrop />
      <BrandHeader />
      <PhotoPanel shot={shot} />
      <ShotCopy shot={shot} eyebrow={eyebrow} title={title} body={body} />
      <ProgressFooter index={index} label={footer} progress={frame / Math.max(1, duration - 1)} />
    </div>
  );
}

function IntroCard() {
  const frame = useCurrentFrame();
  const duration = 4 * SUBMISSION_FPS;
  const opacity = interpolate(frame, [0, 12, duration - 10, duration], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ ...full, opacity }}>
      <SceneBackdrop />
      <BrandHeader label="LOCAL DEMO FILM" />
      <div style={{ position: "absolute", left: 178, top: 238, width: 1200 }}>
        <div style={{ color: sand, fontSize: 14, letterSpacing: "0.24em", textTransform: "uppercase", marginBottom: 31 }}>FROM ONE PHOTO</div>
        <div style={{ color: paper, fontSize: 112, fontWeight: 600, lineHeight: 0.98, letterSpacing: "-0.075em" }}>IntoFrame</div>
        <div style={{ color: "#c5c4bd", fontSize: 34, marginTop: 27, letterSpacing: "-0.025em" }}>Make your photos come alive.</div>
        <div style={{ color: muted, fontSize: 16, marginTop: 73, letterSpacing: "0.12em", textTransform: "uppercase" }}>Real photos · One-time local processing</div>
      </div>
      <ProgressFooter index="00" label="ONE PHOTO, A NEW FRAME" progress={frame / Math.max(1, duration - 1)} />
    </div>
  );
}

function InteractionChapter({ videoUrl }: { videoUrl: string }) {
  const frame = useCurrentFrame();
  const duration = 10 * SUBMISSION_FPS;
  return (
    <div style={full}>
      <SceneBackdrop />
      <BrandHeader label="REAL BROWSER INTERACTION" />
      <div style={{ position: "absolute", left: 100, top: 154, width: 1230, height: 770, border: `1px solid ${line}`, borderRadius: 20, overflow: "hidden", background: "#08090a", boxShadow: "0 34px 100px #0008", display: "grid", placeItems: "center" }}>
        <OffthreadVideo
          src={videoUrl}
          muted
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      </div>
      <div style={{ position: "absolute", left: 1400, top: 228, width: 410 }}>
        <div style={{ color: sand, fontSize: 13, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 27 }}>06 — IN THE BROWSER</div>
        <div style={{ color: paper, fontSize: 46, lineHeight: 1.08, fontWeight: 600, letterSpacing: "-0.055em" }}>A little depth,
          <br />kept in bounds.</div>
        <div style={{ width: 60, height: 1, background: sand, margin: "31px 0 24px" }} />
        <div style={{ color: "#c2c2bc", fontSize: 19, lineHeight: 1.6 }}>Relative depth · bounded 2.5D parallax</div>
        <div style={{ color: muted, fontSize: 15, lineHeight: 1.65, marginTop: 15 }}>One local depth inference drives a shallow, bounded preview. It is not a full 3D reconstruction.</div>
        <div style={{ color: muted, fontSize: 12, letterSpacing: "0.13em", textTransform: "uppercase", marginTop: 29 }}>Actual standalone browser recording</div>
      </div>
      <ProgressFooter index="06" label="REAL UI · REAL INPUT · LOCAL INFERENCE" progress={frame / Math.max(1, duration - 1)} />
    </div>
  );
}

function CreditLine({ shot }: { shot: FilmShot }) {
  const sourceName = shot.sampleId === "tower" ? "Tower photo" : `${shot.sampleTitle} photo`;
  return <div style={{ color: "#c2c2bc", fontSize: 16, lineHeight: 1.75 }}>{sourceName}: {shot.source.author} · {shot.source.license}</div>;
}

function ClosingCard({ props }: { props: SubmissionFilmProps }) {
  const frame = useCurrentFrame();
  const duration = 8 * SUBMISSION_FPS;
  const uniqueShots = [props.pink, props.rocket, props.portrait, props.dog].filter((shot, index, all) => all.findIndex((other) => other.sampleId === shot.sampleId) === index);
  const opacity = interpolate(frame, [0, 12, duration - 12, duration], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ ...full, opacity }}>
      <SceneBackdrop />
      <BrandHeader label="BUILD THE FRAME" />
      <div style={{ position: "absolute", left: 150, top: 174, width: 1000 }}>
        <div style={{ color: sand, fontSize: 13, letterSpacing: "0.22em", textTransform: "uppercase" }}>INTOFRAME</div>
        <div style={{ color: paper, fontSize: 71, lineHeight: 1.03, fontWeight: 600, letterSpacing: "-0.065em", marginTop: 20 }}>Make your photos<br />come alive.</div>
        <div style={{ color: "#c2c2bc", fontSize: 21, marginTop: 24 }}>github.com/brin666/IntoFrame</div>
        <div style={{ height: 1, width: 760, background: line, margin: "34px 0 25px" }} />
        <div style={{ color: sand, fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 12 }}>Photo credits</div>
        {uniqueShots.map((shot) => (
          <div key={shot.sampleId} style={{ marginBottom: 7 }}>
            <CreditLine shot={shot} />
            <div style={{ color: muted, fontSize: 11, lineHeight: 1.45 }}>Source: {shot.source.url}</div>
            <div style={{ color: muted, fontSize: 11, lineHeight: 1.45 }}>License: {shot.source.licenseUrl}</div>
          </div>
        ))}
        <div style={{ color: muted, fontSize: 13, marginTop: 25 }}>Sample assets are precomputed. Processing runs locally in the demo app.</div>
      </div>
      <div style={{ position: "absolute", right: 145, top: 305, width: 470, height: 470, borderRadius: 235, border: `1px solid ${line}`, display: "grid", placeItems: "center", color: "#ffffff09", fontSize: 330, fontWeight: 500, letterSpacing: "-0.1em" }}>↗</div>
      <ProgressFooter index="07" label="INTOFRAME · 2026" progress={frame / Math.max(1, duration - 1)} />
    </div>
  );
}

/** A deterministic 63-second 2D reveal film plus genuine recorded browser footage. */
export function SubmissionFilm(props: SubmissionFilmProps) {
  const intro = 4 * SUBMISSION_FPS;
  const pink = 9 * SUBMISSION_FPS;
  const blueHour = 7 * SUBMISSION_FPS;
  const portrait = 9 * SUBMISSION_FPS;
  const dog = 9 * SUBMISSION_FPS;
  const rocket = 7 * SUBMISSION_FPS;
  const interaction = 10 * SUBMISSION_FPS;
  const closing = 8 * SUBMISSION_FPS;
  let from = 0;
  const segments = [intro, pink, blueHour, portrait, dog, rocket, interaction, closing];
  const starts = segments.map((duration) => {
    const start = from;
    from += duration;
    return start;
  });

  return (
    <div style={{ ...full, background: ink, color: paper, fontFamily: "Manrope, 'DM Sans', Arial, sans-serif", overflow: "hidden" }}>
      <Sequence from={starts[0]} durationInFrames={intro}><IntroCard /></Sequence>
      <Sequence from={starts[1]} durationInFrames={pink}>
        <PhotoChapter shot={props.pink} index="01" eyebrow="01 — DREAMY PINK" title={"One photo.\nA new frame."} body="The original stays visible first. A generated sky and the subject cutout dissolve in together as the cinematic bars land." footer={`${props.pink.sampleId.toUpperCase()} · DREAMY PINK`} duration={pink} />
      </Sequence>
      <Sequence from={starts[2]} durationInFrames={blueHour}>
        <PhotoChapter shot={props.blueHour} index="02" eyebrow="02 — BLUE HOUR" title={"Change the\natmosphere."} body="A second style uses the same portrait source. The foreground subject remains the original cutout." footer="PORTRAIT · BLUE HOUR" duration={blueHour} />
      </Sequence>
      <Sequence from={starts[3]} durationInFrames={portrait}>
        <PhotoChapter shot={props.portrait} index="03" eyebrow="03 — GOLDEN HOUR" title={"Keep the\nperson in front."} body="The matching golden-hour version makes the style change easy to compare while keeping the same subject." footer="PORTRAIT · GOLDEN HOUR" duration={portrait} />
      </Sequence>
      <Sequence from={starts[4]} durationInFrames={dog}>
        <PhotoChapter shot={props.dog} index="04" eyebrow="04 — DREAMY PINK" title={"A frame built\naround the subject."} body="The reveal follows the existing crop. Fine fur stays; foliage boundaries remain a visible limitation." footer="DOG · DREAMY PINK" duration={dog} />
      </Sequence>
      <Sequence from={starts[5]} durationInFrames={rocket}>
        <PhotoChapter shot={props.rocket} index="05" eyebrow="05 — GOLDEN HOUR" title={"Keep the launch\ntrail in frame."} body="The subject cutout retains the plume; the preserved scene keeps the launch site. The distant shuttle remains a small detail in this NASA source photo." footer="ROCKET · GOLDEN HOUR" duration={rocket} />
      </Sequence>
      <Sequence from={starts[6]} durationInFrames={interaction}>
        <InteractionChapter videoUrl={props.interactionVideoUrl} />
      </Sequence>
      <Sequence from={starts[7]} durationInFrames={closing}>
        <ClosingCard props={props} />
      </Sequence>
    </div>
  );
}
