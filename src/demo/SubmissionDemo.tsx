import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type ErrorFallback, type PlayerRef } from "@remotion/player";
import { ArrowDownToLine, ArrowUpRight, Play, RotateCcw, Pause } from "lucide-react";
import { staticFile, type AnyZodObject } from "remotion";
import {
  createSubmissionFilmProps,
  getFilmAssetPaths,
  getManifestSampleLink,
  parseSubmissionManifest,
  resolveSubmissionAsset,
  type SubmissionFilmProps,
  type SubmissionManifest,
} from "./submissionAssets";
import { SubmissionFilm, SUBMISSION_DURATION_IN_FRAMES, SUBMISSION_FPS } from "../remotion/SubmissionFilm";

type DemoState =
  | { status: "loading" }
  | { status: "ready"; manifest: SubmissionManifest; film: SubmissionFilmProps; mp4Ready: boolean }
  | { status: "error"; message: string };

const MP4_PATH = "demo/IntoFrame-demo.mp4";
const MANIFEST_URL = staticFile("samples/manifest.json");

async function checkPublicAsset(url: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { method: "HEAD", cache: "no-store" });
  } catch {
    throw new Error(`Could not reach required demo asset ${url}.`);
  }
  if (!response.ok) throw new Error(`A required demo asset is unavailable (${response.status}): ${url}`);
  if (response.headers.get("content-type")?.includes("text/html"))
    throw new Error(`The demo asset returned a web page instead of media: ${url}`);
}

async function loadDemo(): Promise<Exclude<DemoState, { status: "loading" | "error" }>> {
  const response = await fetch(MANIFEST_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load sample manifest (${response.status}).`);
  const manifest = parseSubmissionManifest(await response.json());
  const film = createSubmissionFilmProps(manifest);
  const assetPaths = getFilmAssetPaths(film);
  await Promise.all(assetPaths.map(checkPublicAsset));

  let mp4Ready = false;
  try {
    await checkPublicAsset(resolveSubmissionAsset(MP4_PATH));
    mp4Ready = true;
  } catch {
    // The web Player remains usable while the render command prepares the MP4.
  }
  return { status: "ready", manifest, film, mp4Ready };
}

function formatTime(frame: number): string {
  const seconds = Math.floor(frame / SUBMISSION_FPS);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function PlayerFailure({ error }: { error: Error }) {
  return (
    <div className="demo-player-failure" role="alert">
      <strong>The demo film could not play.</strong>
      <span>{error.message}</span>
      <span>The downloadable MP4 may still be available below.</span>
    </div>
  );
}

function LoadingCard() {
  return (
    <div className="demo-state-card" role="status" aria-live="polite">
      <span className="demo-state-kicker">INTOFRAME / DEMO</span>
      <strong>Preparing the local examples…</strong>
      <span>Checking the sample images and the real browser recording.</span>
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="demo-state-card demo-error-card" role="alert">
      <span className="demo-state-kicker">DEMO ASSETS UNAVAILABLE</span>
      <strong>The film is waiting for its real assets.</strong>
      <span>{message}</span>
      <button className="demo-secondary-button" type="button" onClick={onRetry}><RotateCcw size={15} /> Try again</button>
    </div>
  );
}

function SampleGallery({ manifest }: { manifest: SubmissionManifest }) {
  return (
    <section className="demo-examples" aria-labelledby="examples-title">
      <div className="demo-section-heading">
        <div>
          <span className="demo-eyebrow">PRECOMPUTED EXAMPLES</span>
          <h2 id="examples-title">Try the source photos</h2>
        </div>
        <p>Open an example in the local app. It does not send a new image or inference request.</p>
      </div>
      <div className="demo-sample-grid">
        {manifest.samples.map((sample) => (
          <article className="demo-sample-card" key={sample.id}>
            <a className="demo-sample-image" href={getManifestSampleLink(sample.id)} aria-label={`Open ${sample.title} example`}>
              <img src={resolveSubmissionAsset(sample.thumbnailUrl)} alt="" loading="lazy" />
              <span className="demo-sample-open"><ArrowUpRight size={16} /></span>
            </a>
            <div className="demo-sample-copy">
              <div><strong>{sample.title}</strong><span>{sample.defaultStyle.replaceAll("-", " ")}</span></div>
              <a href={getManifestSampleLink(sample.id)}>Open example <ArrowUpRight size={13} /></a>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AppShell({ state, onRetry }: { state: DemoState; onRetry: () => void }) {
  const playerRef = useRef<PlayerRef>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const film = state.status === "ready" ? state.film : null;
  const mp4Url = useMemo(() => resolveSubmissionAsset(MP4_PATH), []);
  const playerError = useCallback<ErrorFallback>(({ error }) => <PlayerFailure error={error} />, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const updateFrame = ({ detail }: { detail: { frame: number } }) => setFrame(detail.frame);
    const start = () => setPlaying(true);
    const stop = () => setPlaying(false);
    const ended = () => {
      setPlaying(false);
      setFrame(SUBMISSION_DURATION_IN_FRAMES - 1);
    };
    player.addEventListener("frameupdate", updateFrame);
    player.addEventListener("play", start);
    player.addEventListener("pause", stop);
    player.addEventListener("ended", ended);
    return () => {
      player.removeEventListener("frameupdate", updateFrame);
      player.removeEventListener("play", start);
      player.removeEventListener("pause", stop);
      player.removeEventListener("ended", ended);
    };
  }, [film]);

  function togglePlayback() {
    if (playing) playerRef.current?.pause();
    else {
      if (frame >= SUBMISSION_DURATION_IN_FRAMES - 1) playerRef.current?.seekTo(0);
      playerRef.current?.play();
    }
  }

  return (
    <main className="demo-page">
      <header className="demo-topbar">
        <a className="demo-brand" href="/" aria-label="IntoFrame home">
          <span className="demo-brand-mark"><i /></span>
          <span>IntoFrame</span><span className="demo-brand-note">LOCAL PHOTO TOOL</span>
        </a>
        <div className="demo-topbar-right"><span className="demo-status-dot" /> Architecture film <span className="demo-divider">/</span> {formatTime(SUBMISSION_DURATION_IN_FRAMES)}</div>
      </header>

      <section className="demo-hero">
        <div className="demo-heading">
          <div>
            <span className="demo-eyebrow">ONE PHOTO, A NEW FRAME</span>
            <h1>A subject-aware reveal, in the browser.</h1>
          </div>
          <p>Explore building photos, three sky styles, and the real upload-to-download workflow in this two-and-a-half-minute film.</p>
        </div>

        <div className="demo-player-card">
          {state.status === "loading" && <LoadingCard />}
          {state.status === "error" && <ErrorCard message={state.message} onRetry={onRetry} />}
          {state.status === "ready" && film && (
            <>
              <div className="demo-player-frame">
                <Player<AnyZodObject, SubmissionFilmProps>
                  ref={playerRef}
                  component={SubmissionFilm}
                  inputProps={film}
                  compositionWidth={1920}
                  compositionHeight={1080}
                  fps={SUBMISSION_FPS}
                  durationInFrames={SUBMISSION_DURATION_IN_FRAMES}
                  style={{ width: "100%", height: "100%" }}
                  controls={false}
                  autoPlay={false}
                  loop={false}
                  moveToBeginningWhenEnded={false}
                  initiallyMuted
                  initialVolume={0}
                  numberOfSharedAudioTags={0}
                  clickToPlay={false}
                  doubleClickToFullscreen={false}
                  spaceKeyToPlayOrPause={false}
                  allowFullscreen={false}
                  errorFallback={playerError}
                />
              </div>
              <div className="demo-transport">
                <button className="demo-play-button" onClick={togglePlayback} type="button" aria-label={playing ? "Pause film" : "Play film"}>
                  {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                </button>
                <span className="demo-timecode">{formatTime(frame)}</span>
                <input
                  className="demo-scrubber"
                  aria-label="Scrub through the demo film"
                  type="range"
                  min={0}
                  max={SUBMISSION_DURATION_IN_FRAMES - 1}
                  value={frame}
                  onChange={(event) => {
                    const nextFrame = Number(event.currentTarget.value);
                    setFrame(nextFrame);
                    playerRef.current?.seekTo(nextFrame);
                  }}
                />
                <span className="demo-timecode">{formatTime(SUBMISSION_DURATION_IN_FRAMES)}</span>
                {state.mp4Ready ? (
                  <a className="demo-download-button" href={mp4Url} download="IntoFrame-demo.mp4"><ArrowDownToLine size={16} /><span>Download MP4</span></a>
                ) : (
                  <span className="demo-download-pending" title="The MP4 will appear after npm run demo:render">MP4 rendering</span>
                )}
              </div>
              <div className="demo-player-note">Playback starts when you press play. No music or autoplay.</div>
            </>
          )}
        </div>

        <div className="demo-feature-notes" aria-label="What this film shows">
          <div><span>01</span><strong>Subject stays in front</strong><p>The original subject remains above the generated background.</p></div>
          <div><span>02</span><strong>From original to cinematic</strong><p>The photo transitions into a new sky and a frame the subject can cross.</p></div>
          <div><span>03</span><strong>Local depth preview</strong><p>Relative depth drives a bounded 2.5D parallax. It is not full 3D.</p></div>
        </div>
      </section>

      {state.status === "ready" && <SampleGallery manifest={state.manifest} />}

      <footer className="demo-footer">
        <div className="demo-footer-brand"><span className="demo-brand-mark"><i /></span><strong>IntoFrame</strong></div>
        <div className="demo-credits">
          {state.status === "ready" && state.manifest.samples.filter((sample, index, all) => all.findIndex((other) => other.id === sample.id) === index).map((sample) => (
            <div key={sample.id}>
              <span>{sample.id === "tower" ? "Tower photo" : `${sample.title} photo`}: {sample.source.author} · {sample.source.license}</span>
              <span className="demo-credit-links">
                <a href={sample.source.url} target="_blank" rel="noreferrer">Source <ArrowUpRight size={12} /></a>
                <a href={sample.source.licenseUrl} target="_blank" rel="noreferrer">License <ArrowUpRight size={12} /></a>
              </span>
            </div>
          ))}
        </div>
        <div className="demo-repo"><span>Project source</span><a href="https://github.com/brin666/IntoFrame" target="_blank" rel="noreferrer">github.com/brin666/IntoFrame <ArrowUpRight size={14} /></a></div>
      </footer>
    </main>
  );
}

export default function SubmissionDemo() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DemoState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    loadDemo()
      .then((ready) => { if (active) setState(ready); })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "A demo asset could not be loaded.",
        });
      });
    return () => { active = false; };
  }, [attempt]);

  return <AppShell state={state} onRetry={() => setAttempt((value) => value + 1)} />;
}
