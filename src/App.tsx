import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Download,
  ImagePlus,
  RotateCcw,
  ScanLine,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import {
  createDepth,
  createJob,
  createRestyle,
  getDepth,
  getJob,
  getRestyle,
  CURRENT_ATMOSPHERE_VERSION,
  type DepthResult,
  type Result,
  type RestyleResult,
  type StyleId,
} from "./api";
import { exportFrame } from "./exportFrame";
import { FILM_BAR_FRACTION } from "./frameComposition";
import { loadDemoSamples, type DemoSample } from "./samples";
import type { SceneInteraction } from "./sceneMotion";
import type { PhotoRevealProps } from "./remotion/PhotoReveal";
const PhotoRevealPlayer = lazy(() =>
  import("./PhotoRevealPlayer")
    .then((module) => ({ default: module.PhotoRevealPlayer }))
    .catch(() => ({ default: RevealLoadFailure })),
);
function RevealLoadFailure({ onUnavailable }: { onUnavailable: (message: string) => void }) {
  useEffect(() => {
    onUnavailable("Could not load the transition. Your photo preview is still available.");
  }, [onUnavailable]);
  return <></>;
}
const SpatialFrameScene = lazy(() =>
  import("./SpatialFrameScene").then((module) => ({
    default: module.SpatialFrameScene,
  })).catch(() => ({ default: SpatialLoadFailure })),
);
function SpatialLoadFailure({ onUnavailable }: { onUnavailable: (message: string) => void }) {
  useEffect(() => { onUnavailable("Could not load spatial rendering. Your still preview is available."); }, [onUnavailable]);
  return <></>;
}

type Mode = "upload" | "processing" | "preview" | "error";
interface DragPointer {
  id: number;
  startX: number;
  startY: number;
  width: number;
  axis: "pending" | "horizontal";
}
interface RevealRequest {
  token: number;
  jobId: string;
  style: StyleId;
  input: PhotoRevealProps;
}
const supported = ["image/jpeg", "image/png", "image/webp"];
const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));
function clearSampleQuery() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("sample")) return;
  url.searchParams.delete("sample");
  window.history.replaceState(null, "", url);
}
const stageLabels: Record<string, string> = {
  queued: "Waiting for the image engine",
  preparing: "Preparing your image",
  segmenting: "Finding your subject",
  "checking-sky": "Checking visible sky",
};
const styleOptions: { id: StyleId; name: string; detail: string }[] = [
  { id: "dreamy-pink", name: "Dreamy Pink", detail: "Pink, lavender, soft clouds" },
  { id: "golden-hour", name: "Golden Hour", detail: "Warm natural sunset" },
  { id: "cinematic-night", name: "Cinematic Night", detail: "Blue-hour sky, soft clouds" },
];
const restyleStageLabels: Record<string, string> = {
  queued: "Waiting for the image engine",
  "loading-model": "Loading the local AI model",
  generating: "Painting a new background",
  compositing: "Protecting the original subject",
};

function App() {
  const [mode, setMode] = useState<Mode>("upload");
  const [stage, setStage] = useState("queued");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [depthResult, setDepthResult] = useState<DepthResult | null>(null);
  const [depthStage, setDepthStage] = useState("queued");
  const [depthError, setDepthError] = useState("");
  const [readyDepth, setReadyDepth] = useState<DepthResult | null>(null);
  const [spatialError, setSpatialError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [pageActive, setPageActive] = useState(() => !document.hidden);
  const [motionNotice, setMotionNotice] = useState("");
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [filename, setFilename] = useState("");
  const [zoom, setZoom] = useState(1);
  const [showMask, setShowMask] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<StyleId>("dreamy-pink");
  const [styles, setStyles] = useState<Partial<Record<StyleId, RestyleResult>>>({});
  const [showBefore, setShowBefore] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationStage, setGenerationStage] = useState("queued");
  const [generationError, setGenerationError] = useState("");
  const [exportError, setExportError] = useState("");
  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const [revealError, setRevealError] = useState("");
  const revealTokenRef = useRef(0);
  const activeRevealTokenRef = useRef<number | null>(null);
  const compositionRef = useRef({ zoom: 1, shiftX: 0, shiftY: 0, reducedMotion: false });
  const inputRef = useRef<HTMLInputElement>(null);
  const photoStageRef = useRef<HTMLDivElement>(null);
  const heldPointerRef = useRef<DragPointer | null>(null);
  const sceneInteractionRef = useRef<SceneInteraction>({ active: false, deltaX: 0,
    gestureId: 0, touch: window.matchMedia("(pointer: coarse)").matches });
  const requestRef = useRef(0);
  const generationRequestRef = useRef(0);
  const [demoSamples, setDemoSamples] = useState<DemoSample[]>([]);
  const [samplesError, setSamplesError] = useState("");
  const demoSampleRef = useRef<DemoSample | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadDemoSamples().then((samples) => {
      if (cancelled) return;
      setDemoSamples(samples);
      const id = new URLSearchParams(window.location.search).get("sample");
      const sample = samples.find((item) => item.id === id);
      if (sample && requestRef.current === 0) openDemoSample(sample);
    }).catch((cause) => {
      if (!cancelled) setSamplesError(cause instanceof Error ? cause.message : "Sample photos could not be loaded.");
    });
    return () => { cancelled = true; };
  }, []);

  function openDemoSample(sample: DemoSample) {
    requestRef.current += 1;
    generationRequestRef.current += 1;
    stopDrag();
    demoSampleRef.current = sample;
    setError("");
    setFilename(`${sample.id}.webp`);
    setResult(sample.result);
    setZoom(sample.result.composition.scale);
    setStyles(sample.styles);
    setSelectedStyle(sample.defaultStyle);
    setShowBefore(false);
    setShowMask(false);
    setShowControls(false);
    setGenerating(false);
    setGenerationError("");
    setExportError("");
    setReveal(null);
    setRevealError("");
    setSpatialError("");
    setMode("preview");
  }

  useEffect(
    () => () => {
      requestRef.current += 1;
      generationRequestRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (!result) return;
    if (demoSampleRef.current?.result.id === result.id) {
      setDepthResult(demoSampleRef.current.depth);
      setDepthStage("complete");
      setDepthError("");
      setReadyDepth(null);
      return;
    }
    let cancelled = false;
    setDepthResult(null);
    setDepthError("");
    setDepthStage("queued");
    setReadyDepth(null);
    async function processDepth() {
      try {
        await createDepth(result!.id);
        while (!cancelled) {
          const job = await getDepth(result!.id);
          if (cancelled) return;
          setDepthStage(job.stage);
          if (job.status === "complete" && job.result) {
            setDepthResult(job.result);
            return;
          }
          if (job.status === "failed")
            throw new Error(job.error || "Depth analysis failed.");
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      } catch (cause) {
        if (!cancelled)
          setDepthError(
            cause instanceof Error ? cause.message : "Depth analysis failed.",
          );
      }
    }
    void processDepth();
    return () => {
      cancelled = true;
    };
  }, [result]);

  async function handleFile(file?: File) {
    if (!file) return;
    if (!supported.includes(file.type)) {
      setError("Choose a JPG, PNG or WebP image.");
      setMode("error");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("Choose an image smaller than 20 MB.");
      setMode("error");
      return;
    }
    const request = ++requestRef.current;
    demoSampleRef.current = null;
    clearSampleQuery();
    generationRequestRef.current += 1;
    setFilename(file.name);
    setError("");
    setResult(null);
    setDepthResult(null);
    setDepthError("");
    setReadyDepth(null);
    setStyles({});
    setSelectedStyle("dreamy-pink");
    setShowBefore(false);
    setGenerating(false);
    setGenerationError("");
    setExportError("");
    setReveal(null);
    setRevealError("");
    stopDrag();
    setStage("queued");
    setMode("processing");
    try {
      const id = await createJob(file);
      while (request === requestRef.current) {
        const job = await getJob(id);
        if (request !== requestRef.current) return;
        setStage(job.stage);
        if (job.status === "complete" && job.result) {
          setResult(job.result);
          setZoom(job.result.composition.scale);
          setShowMask(false);
          setShowControls(false);
          setMode("preview");
          return;
        }
        if (job.status === "failed")
          throw new Error(job.error || "AI processing failed.");
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    } catch (cause) {
      if (request !== requestRef.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not process this image.",
      );
      setMode("error");
    }
  }

  function onInput(event: ChangeEvent<HTMLInputElement>) {
    void handleFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragging(false);
    void handleFile(event.dataTransfer.files[0]);
  }

  function reset() {
    requestRef.current += 1;
    generationRequestRef.current += 1;
    setResult(null);
    demoSampleRef.current = null;
    clearSampleQuery();
    setDepthResult(null);
    setReveal(null);
    setRevealError("");
    stopDrag();
    setError("");
    setMode("upload");
  }

  async function generateStyle() {
    if (!result || generating || !result.sky.eligible) return;
    stopDrag();
    setReveal(null);
    setRevealError("");
    if (styles[selectedStyle]?.atmosphereVersion === CURRENT_ATMOSPHERE_VERSION) {
      setShowBefore(false);
      playReveal(styles[selectedStyle]!);
      return;
    }
    const request = ++generationRequestRef.current;
    const style = selectedStyle;
    setGenerationError("");
    setGenerationStage("queued");
    setGenerating(true);
    try {
      await createRestyle(result.id, style);
      while (request === generationRequestRef.current) {
        const job = await getRestyle(result.id, style);
        if (request !== generationRequestRef.current) return;
        setGenerationStage(job.stage);
        if (job.status === "complete" && job.result) {
          setStyles((current) => ({ ...current, [style]: job.result }));
          setSelectedStyle(style);
          setShowBefore(false);
          setGenerating(false);
          playReveal(job.result);
          return;
        }
        if (job.status === "failed") throw new Error(job.error || "Background generation failed.");
        await new Promise((resolve) => setTimeout(resolve, 1400));
      }
    } catch (cause) {
      if (request !== generationRequestRef.current) return;
      setGenerationError(cause instanceof Error ? cause.message : "Background generation failed.");
      setGenerating(false);
    }
  }

  const stopDrag = useCallback(() => {
    const pointer = heldPointerRef.current;
    heldPointerRef.current = null;
    sceneInteractionRef.current.active = false;
    sceneInteractionRef.current.deltaX = 0;
    if (pointer && photoStageRef.current?.hasPointerCapture(pointer.id)) {
      photoStageRef.current.releasePointerCapture(pointer.id);
    }
    setDragging(false);
  }, []);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!canExplore || !event.isPrimary || event.button !== 0 || heldPointerRef.current ||
      !Number.isFinite(event.clientX + event.clientY)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width < 1) return;
    const touch = event.pointerType === "touch";
    heldPointerRef.current = { id: event.pointerId, startX: event.clientX,
      startY: event.clientY, width: bounds.width, axis: touch ? "pending" : "horizontal" };
    sceneInteractionRef.current = { active: true, deltaX: 0,
      gestureId: sceneInteractionRef.current.gestureId + 1, touch };
    // Touch waits for horizontal intent; native vertical scrolling stays free.
    if (!touch) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        stopDrag();
        return;
      }
      setDragging(true);
    }
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerId === heldPointerRef.current?.id) stopDrag();
  }

  function lostDragCapture(event: PointerEvent<HTMLDivElement>) {
    // Touch begins with implicit capture on the hit image/canvas. Transferring
    // it to the stage emits a bubbled loss from that child, not from our drag.
    if (event.target !== event.currentTarget ||
      event.currentTarget.hasPointerCapture(event.pointerId)) return;
    endDrag(event);
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const pointer = heldPointerRef.current;
    if (!pointer || event.pointerId !== pointer.id) return;
    if (!canExplore || !Number.isFinite(event.clientX + event.clientY) ||
      (event.pointerType === "mouse" && event.buttons === 0)) {
      stopDrag();
      return;
    }
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    if (pointer.axis === "pending") {
      if (Math.abs(dy) >= 8 && Math.abs(dy) > Math.abs(dx) * 1.15) {
        stopDrag();
        return;
      }
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      pointer.axis = "horizontal";
      try {
        event.currentTarget.setPointerCapture(pointer.id);
      } catch {
        stopDrag();
        return;
      }
      setDragging(true);
    }
    if (event.cancelable) event.preventDefault();
    sceneInteractionRef.current.deltaX = clamp(dx / pointer.width, -2, 2);
  }

  function leaveDrag(event: PointerEvent<HTMLDivElement>) {
    const pointer = heldPointerRef.current;
    if (pointer?.id === event.pointerId && pointer.axis === "pending") stopDrag();
  }

  useEffect(() => {
    const blur = () => { stopDrag(); setPageActive(false); };
    const focus = () => setPageActive(!document.hidden);
    const visibility = () => {
      if (document.hidden) stopDrag();
      setPageActive(!document.hidden && document.hasFocus());
    };
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [stopDrag]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const horizontalLimit = (zoom - 1) / 2;
  const verticalLimit = horizontalLimit + FILM_BAR_FRACTION;
  const xShift = result
    ? clamp(
        -zoom * (result.composition.focusX - 0.5),
        -horizontalLimit,
        horizontalLimit,
      )
    : 0;
  const baseYShift = result
    ? clamp(
        result.subjectBounds[1] <= result.height * 0.04
          ? Math.max(
              -0.08 - zoom * (result.composition.focusY - 0.5),
              0.02 - (1 - zoom) / 2 - zoom * result.subjectBounds[1] / result.height,
            )
          : -0.08 - zoom * (result.composition.focusY - 0.5),
        -verticalLimit,
        verticalLimit,
      )
    : 0;
  // Keep a visible sky band when framing a low-positioned outdoor subject.
  // The identical center transform is shared by Before, After and PNG export.
  const skyBottom = result?.sky.bounds ? result.sky.bounds[3] / result.height : 1;
  const yShift = result?.sky.eligible
    ? clamp(Math.max(baseYShift, FILM_BAR_FRACTION + 0.15 - (1 - zoom) / 2 - zoom * skyBottom), -verticalLimit, verticalLimit)
    : baseYShift;
  compositionRef.current = { zoom, shiftX: xShift, shiftY: yShift,
    reducedMotion: prefersReducedMotion };

  function playReveal(styled: RestyleResult) {
    stopDrag();
    setRevealError("");
    const composition = compositionRef.current;
    if (!result || composition.reducedMotion) {
      setReveal(null);
      return;
    }
    setReveal({ token: ++revealTokenRef.current, jobId: result.id, style: styled.style,
      input: { sourceUrl: result.sourceUrl, backgroundUrl: styled.backgroundUrl,
        subjectUrl: styled.subjectUrl, width: result.width, height: result.height,
        zoom: composition.zoom, shiftX: composition.shiftX, shiftY: composition.shiftY } });
  }
  const previewStyle = result
    ? ({
        aspectRatio: `${result.width} / ${result.height}`,
        "--photo-zoom": zoom,
        "--photo-x": `${xShift * 100}%`,
        "--photo-y": `${yShift * 100}%`,
        "--film-bar-height": `${FILM_BAR_FRACTION * 100}%`,
      } as CSSProperties)
    : undefined;
  const backgroundFallbackStyle = depthResult
    ? ({
        position: "absolute",
        width: `${(depthResult.renderWidth / depthResult.width) * 100}%`,
        height: `${(depthResult.renderHeight / depthResult.height) * 100}%`,
        left: `${(-depthResult.padding.left / depthResult.width) * 100}%`,
        top: `${(-depthResult.padding.top / depthResult.height) * 100}%`,
      } as CSSProperties)
    : undefined;
  const styledResult = styles[selectedStyle];
  const showingStyled = Boolean(styledResult && !showBefore);
  const activeReveal = reveal && result?.id === reveal.jobId &&
    selectedStyle === reveal.style && showingStyled && !showMask &&
    !prefersReducedMotion && reveal.input.zoom === zoom &&
    reveal.input.shiftX === xShift && reveal.input.shiftY === yShift
    ? reveal : null;
  const revealActive = activeReveal !== null;
  activeRevealTokenRef.current = activeReveal?.token ?? null;
  const visibleDepth = useMemo(
    () => depthResult && showingStyled && styledResult
      ? { ...depthResult, backgroundUrl: styledResult.renderBackgroundUrl,
          renderSkyUrl: styledResult.renderSkyUrl, renderSceneUrl: styledResult.renderSceneUrl }
      : depthResult,
    [depthResult, showingStyled, styledResult],
  );
  // Readiness belongs to this exact scene, never to a previous texture.
  const spatialReady = visibleDepth !== null && readyDepth === visibleDepth;
  const visibleBackgroundUrl = showingStyled && styledResult
    ? (depthResult ? styledResult.renderBackgroundUrl : styledResult.backgroundUrl)
    : (depthResult?.backgroundUrl || result?.sourceUrl || "");
  const canExplore = spatialReady && !showBefore && !generating && !showMask &&
    !prefersReducedMotion && pageActive && !revealActive;

  useEffect(() => {
    if (reveal && !activeReveal) setReveal(null);
  }, [reveal, activeReveal]);

  useEffect(() => {
    setReadyDepth(null);
    setSpatialError("");
    setMotionNotice("");
    stopDrag();
  }, [visibleDepth, stopDrag]);

  useEffect(() => {
    if (!canExplore) stopDrag();
  }, [canExplore, stopDrag]);

  async function downloadPng() {
    if (!result || !styledResult) return;
    setExportError("");
    try {
      await exportFrame({ ...result, subjectUrl: styledResult.subjectUrl }, styledResult.backgroundUrl, zoom, xShift, yShift, filename);
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "Could not export PNG.");
    }
  }

  return (
    <div
      className="app-shell"
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setIsDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="topbar">
        <button className="brand" onClick={reset} aria-label="IntoFrame home">
          <span className="brand-mark">
            <span />
          </span>
          <span>IntoFrame</span>
          <sup>LAB / 01</sup>
        </button>
        <div className="topbar-right">
          <a className="demo-film-link" href="/demo.html">Watch demo</a>
          <span className="topbar-note">
            A little more life in every frame.
          </span>
          <span className="phase-pill">
            <span className="phase-dot" /> SPATIAL STUDIO
          </span>
        </div>
      </header>

      {mode === "preview" && result ? (
        <main className="preview-page">
          <div className="preview-heading">
            <button className="back-button" onClick={reset}>
              <ArrowLeft size={17} /> New photo
            </button>
            <div className="preview-title">
              <span className="eyebrow">YOUR FRAME IS READY</span>
              <h1>
                Beyond the frame<span className="title-period">.</span>
              </h1>
              <p>
                A gentle drift brings the scene to life. Drag left or right to
                explore the depth.
              </p>
            </div>
            <button
              className="icon-text-button"
              onClick={() => setShowControls(!showControls)}
              aria-expanded={showControls}
            >
              <SlidersHorizontal size={17} /> Adjust frame
            </button>
          </div>
          <div
            className="photo-presentation"
            style={{
              maxWidth: `min(1050px, ${(result.width / result.height) * 68}vh)`,
            }}
          >
            <div
              className={`photo-stage ${canExplore ? "spatial-ready" : ""} ${dragging && canExplore ? "is-dragging" : ""} ${revealActive ? "is-revealing" : ""}`}
              data-reveal={revealActive ? "active" : "idle"}
              style={previewStyle}
              ref={photoStageRef}
              onPointerDown={startDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onPointerMove={moveDrag}
              onPointerLeave={leaveDrag}
              onLostPointerCapture={lostDragCapture}
              aria-label={
                canExplore
                  ? "Interactive spatial photo. Drag left or right to explore depth."
                  : "Cinematic photo preview"
              }
            >
              <div className="scene-layer background-layer">
                <div className="background-content">
                  <img
                    src={visibleBackgroundUrl}
                    style={backgroundFallbackStyle}
                    alt="Photograph background"
                    draggable="false"
                  />
                  {visibleDepth && !depthError && (
                    <Suspense fallback={null}>
                      <SpatialFrameScene
                        depth={visibleDepth}
                        backgroundMode={showingStyled ? "sky-layers" : "photo-depth"}
                        subjectUrl={showingStyled && styledResult ? styledResult.subjectUrl : result.subjectUrl}
                        result={result}
                        zoom={zoom}
                        shiftX={xShift}
                        interaction={sceneInteractionRef}
                        onMotionNotice={setMotionNotice}
                        stage={photoStageRef}
                        autonomousEnabled={canExplore}
                        travelScale={1}
                        onReady={(renderedDepth) => { setReadyDepth(renderedDepth); setSpatialError(""); }}
                        onUnavailable={(message) => {
                          setSpatialError(message);
                          setReadyDepth(null);
                        }}
                      />
                    </Suspense>
                  )}
                </div>
              </div>
              <div className="letterbox letterbox-top" />
              <div className="letterbox letterbox-bottom" />
              <div className="scene-layer subject-layer">
                <img
                  src={showingStyled && styledResult ? styledResult.subjectUrl : result.subjectUrl}
                  alt="Segmented foreground subject"
                  draggable="false"
                />
              </div>
              {showMask && (
                <div className="scene-layer mask-layer">
                  <img src={result.maskUrl} alt="AI subject mask" />
                </div>
              )}
              {activeReveal && (
                <Suspense fallback={
                  <div className="photo-reveal-overlay">
                    <img src={activeReveal.input.sourceUrl} alt="Original photograph" draggable="false" />
                  </div>
                }>
                  <PhotoRevealPlayer
                    key={activeReveal.token}
                    input={activeReveal.input}
                    playing={pageActive}
                    onComplete={() => setReveal((current) => current?.token === activeReveal.token ? null : current)}
                    onUnavailable={(message) => {
                      if (activeRevealTokenRef.current !== activeReveal.token) return;
                      setReveal((current) => current?.token === activeReveal.token ? null : current);
                      setRevealError(message);
                    }}
                  />
                </Suspense>
              )}
            </div>
            <div className="photo-corner photo-corner-tl" />
            <div className="photo-corner photo-corner-br" />
          </div>
          <section className="style-studio" aria-label="AI background styles">
            <div className="style-studio-heading">
              <div>
                <span className="eyebrow">AI BACKGROUND STUDIO</span>
                <h2>Choose the atmosphere.</h2>
              </div>
              <span className="style-studio-note">AI sky + your subject, with balanced colors.</span>
            </div>
            <div className="style-choices">
              {styleOptions.map((option) => (
                <button
                  key={option.id}
                  className={`style-choice ${selectedStyle === option.id ? "selected" : ""}`}
                  disabled={generating}
                  onClick={() => { stopDrag(); setReveal(null); setSelectedStyle(option.id); setShowBefore(false); setGenerationError(""); }}
                  aria-pressed={selectedStyle === option.id}
                >
                  <span className={`style-swatch ${option.id}`} />
                  <span><strong>{option.name}</strong><small>{option.detail}</small></span>
                  {styles[option.id] && <Check size={16} aria-label="Generated" />}
                </button>
              ))}
            </div>
            <div className="style-actions">
              <button className="style-primary" onClick={() => void generateStyle()} disabled={generating || !result.sky.eligible}>
                {generating ? <span className="loading-spinner" /> : <Sparkles size={17} />}
                {generating ? (restyleStageLabels[generationStage] || "Generating your background") : styledResult ? (styledResult.atmosphereVersion === CURRENT_ATMOSPHERE_VERSION ? "Show result" : "Update atmosphere") : "Generate background"}
              </button>
              <button className="action-button" onClick={() => { stopDrag(); setReveal(null); setShowBefore(!showBefore); }} disabled={!styledResult}>
                {showBefore ? "View after" : "View before"}
              </button>
              <button className="action-button" onClick={() => void downloadPng()} disabled={!styledResult || generating || showBefore || showMask}>
                <Download size={17} /> Download PNG
              </button>
              <button className="action-button" disabled={!styledResult || generating || showBefore || showMask || prefersReducedMotion}
                onClick={() => revealActive ? setReveal(null) : styledResult && playReveal(styledResult)}>
                <RotateCcw size={16} /> {revealActive ? "Skip animation" : "Replay transition"}
              </button>
            </div>
            {generating && <p className="style-status" role="status">{restyleStageLabels[generationStage] || "Generating"} · First use downloads model weights and can take several minutes.</p>}
            {generationError && <p className="style-error" role="alert">{generationError}</p>}
            {exportError && <p className="style-error" role="alert">{exportError}</p>}
            {revealError && <p className="style-error" role="alert">{revealError}</p>}
            {!result.sky.eligible && <p className="style-status" role="status">{result.sky.reason}</p>}
            <p className="style-status">Only confirmed sky is replaced. Subject and scene details stay, with gentle color balancing. PNG saves the centered, still composition. {selectedStyle === "cinematic-night" && "Blue-hour tones keep the subject visible."}</p>
          </section>
          <div className="preview-footer">
            <div className="result-caption">
              <span className="result-count">01 / 01</span>
              <span className="caption-divider" />
              <span className="result-name" title={filename}>
                {filename}
              </span>
              <span className="result-tag">
                <Check size={13} /> AI subject isolated
              </span>
            </div>
            <div className="result-actions">
              <button
                onClick={() => { stopDrag(); setReveal(null); setShowMask(!showMask); }}
                className={showMask ? "action-button active" : "action-button"}
              >
                <ScanLine size={17} /> {showMask ? "Hide mask" : "View mask"}
              </button>
              <button
                onClick={() => setZoom(result.composition.scale)}
                className="action-button"
              >
                <RotateCcw size={16} /> Reset crop
              </button>
            </div>
          </div>
          {result.compositionNotice && (
            <p className="composition-notice">{result.compositionNotice}</p>
          )}
          {motionNotice && <p className="composition-notice" role="status">{motionNotice}</p>}
          {showControls && (
            <section
              className="controls-panel"
              aria-label="Composition controls"
            >
              <div>
                <span className="eyebrow">COMPOSITION</span>
                <h2>Give the subject room to break through.</h2>
                <p>
                  Zoom keeps the photo and its AI mask aligned. Small subjects
                  may need a tighter crop.
                </p>
              </div>
              <label className="zoom-control">
                <span>
                  Frame zoom <strong>{Math.round(zoom * 100)}%</strong>
                </span>
                <input
                  type="range"
                  min="1"
                  max="2.4"
                  step="0.01"
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
              </label>
              <button
                className="panel-close"
                onClick={() => setShowControls(false)}
                aria-label="Close controls"
              >
                <X size={18} />
              </button>
            </section>
          )}
          <p className="phase-note" role="status">
            {revealActive
              ? "Playing the photo transition · Skip animation to return to the preview."
              : depthError || spatialError
              ? `Static preview available. Spatial analysis: ${depthError || spatialError}`
              : spatialReady
                ? prefersReducedMotion
                  ? "Spatial preview ready · Motion is reduced in your system settings."
                  : !showBefore && !generating && !showMask
                    ? "DRAG TO EXPLORE · Move left or right; release to return to the gentle drift."
                    : "Still comparison · View the original preview or After to explore depth."
                : `Static preview ready · Preparing spatial depth (${depthStage}).`}
          </p>
        </main>
      ) : (
        <main className="landing">
          <section className="hero-copy">
            <div className="hero-kicker">
              <span className="kicker-line" /> THE SPATIAL PHOTO STUDIO{" "}
              <span className="kicker-number">001</span>
            </div>
            <h1>
              Make your photos
              <br />
              <em>come alive.</em>
            </h1>
            <p>
              Generate a new AI sky, keep your original subject, and create a
              cinematic frame. Best with photos taken against an open sky.
            </p>
            <div className="hero-small">
              <span className="small-star">✳</span>
              <span>
                START WITH A PHOTO.
                <br />
                WE’LL FIND THE MOMENT.
              </span>
            </div>
          </section>
          <section
            className={`upload-card ${isDragging ? "dragging" : ""}`}
            aria-label="Upload image"
          >
            <div className="upload-top">
              <span>01 / CREATE A FRAME</span>
              <ArrowUpRight size={18} />
            </div>
            <div className="upload-center">
              <div className="upload-icon">
                <ImagePlus size={27} strokeWidth={1.5} />
              </div>
              <div className="upload-copy">
                <h2>
                  {mode === "processing"
                    ? stageLabels[stage] || "Processing your photo"
                    : mode === "error"
                      ? "That didn’t work."
                      : "Every photo has a way out."}
                </h2>
                <p>
                  {mode === "processing"
                    ? "Your photo is being analyzed locally. First run may download the AI model."
                    : mode === "error"
                      ? error
                      : "Drop a favorite image here, or choose one from your device."}
                </p>
              </div>
              {mode === "processing" ? (
                <div className="processing-row">
                  <span className="loading-spinner" />
                  <span>AI PROCESSING · {stage.toUpperCase()}</span>
                </div>
              ) : (
                <button
                  className="upload-button"
                  onClick={() => inputRef.current?.click()}
                >
                  <UploadCloud size={18} />{" "}
                  {mode === "error" ? "Try another photo" : "Choose a photo"}{" "}
                  <ArrowUpRight size={17} />
                </button>
              )}
            </div>
            <div className="upload-bottom">
              <span>JPG · PNG · WEBP</span>
              <span>UP TO 20 MB</span>
            </div>
          </section>
          <div className="landing-bottom">
            <div className="process-step">
              <span>01</span>
              <div>
                <strong>Find the subject</strong>
                <small>AI isolates the focal point</small>
              </div>
            </div>
            <div className="step-rule" />
            <div className="process-step">
              <span>02</span>
              <div>
                <strong>Break the frame</strong>
                <small>A cinematic composition emerges</small>
              </div>
            </div>
            <div className="step-rule" />
            <div className="process-step muted">
              <span>03</span>
              <div>
                <strong>Feel the space</strong>
                <small>Drag to explore the depth</small>
              </div>
            </div>
          </div>
        </main>
      )}
      {mode === "upload" && (demoSamples.length > 0 || samplesError) && (
        <section className="sample-gallery" aria-label="Demo photos">
          <div className="sample-gallery-heading">
            <div><span className="eyebrow">TRY A REAL EXAMPLE</span><h2>Choose a ready-made frame.</h2></div>
            <p>Processed locally. Explore, compare, or replay the transformation.</p>
          </div>
          {samplesError ? <p role="status">{samplesError}</p> : (
            <div className="sample-grid">
              {demoSamples.map((sample) => (
                <button className="sample-card" key={sample.id} onClick={() => openDemoSample(sample)}>
                  <img src={sample.thumbnailUrl} alt={sample.title} loading="lazy" />
                  <span><strong>{sample.title}</strong><small>{sample.category}</small></span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      {mode === "preview" && demoSampleRef.current && (
        <p className="sample-credit">Sample photo: <a href={demoSampleRef.current.source.url} target="_blank" rel="noreferrer">{demoSampleRef.current.source.author}</a> · {demoSampleRef.current.source.license}</p>
      )}
      <input
        ref={inputRef}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onInput}
      />
      <footer className="site-footer">
        <span>INTOFRAME © 2026</span>
        <span>
          MADE TO SEE DIFFERENTLY <Sparkles size={12} />
        </span>
      </footer>
    </div>
  );
}

export default App;
