import {
  lazy,
  Suspense,
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
  type DepthResult,
  type Result,
  type RestyleResult,
  type StyleId,
} from "./api";
import { exportFrame } from "./exportFrame";
import { FILM_BAR_FRACTION } from "./frameComposition";
const SpatialFrameScene = lazy(() =>
  import("./SpatialFrameScene").then((module) => ({
    default: module.SpatialFrameScene,
  })),
);

type Mode = "upload" | "processing" | "preview" | "error";
const supported = ["image/jpeg", "image/png", "image/webp"];
const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));
const stageLabels: Record<string, string> = {
  queued: "Waiting for the image engine",
  preparing: "Preparing your image",
  segmenting: "Finding your subject",
};
const styleOptions: { id: StyleId; name: string; detail: string }[] = [
  { id: "dreamy-pink", name: "Dreamy Pink", detail: "Pink, lavender, soft clouds" },
  { id: "golden-hour", name: "Golden Hour", detail: "Warm natural sunset" },
  { id: "cinematic-night", name: "Cinematic Night", detail: "Deep blue, subtle stars" },
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
  const [spatialReady, setSpatialReady] = useState(false);
  const [holding, setHolding] = useState(false);
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
  const inputRef = useRef<HTMLInputElement>(null);
  const photoStageRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const generationRequestRef = useRef(0);

  useEffect(
    () => () => {
      requestRef.current += 1;
      generationRequestRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    setDepthResult(null);
    setDepthError("");
    setDepthStage("queued");
    setSpatialReady(false);
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
    generationRequestRef.current += 1;
    setFilename(file.name);
    setError("");
    setResult(null);
    setDepthResult(null);
    setDepthError("");
    setSpatialReady(false);
    setStyles({});
    setSelectedStyle("dreamy-pink");
    setShowBefore(false);
    setGenerating(false);
    setGenerationError("");
    setExportError("");
    setHolding(false);
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
    setDepthResult(null);
    setHolding(false);
    setError("");
    setMode("upload");
  }

  async function generateStyle() {
    if (!result || generating) return;
    if (styles[selectedStyle]) {
      setShowBefore(false);
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

  function startHold(event: PointerEvent<HTMLDivElement>) {
    if (!spatialReady || showMask || prefersReducedMotion) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setHolding(true);
  }

  function endHold(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setHolding(false);
  }

  useEffect(() => {
    const settle = () => setHolding(false);
    window.addEventListener("blur", settle);
    return () => window.removeEventListener("blur", settle);
  }, []);

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
  const yShift = result
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
  const touchesImageEdge = result
    ? result.subjectBounds[0] <= result.width * 0.02 ||
      result.subjectBounds[1] <= result.height * 0.02 ||
      result.subjectBounds[2] >= result.width * 0.98 ||
      result.subjectBounds[3] >= result.height * 0.98
    : false;
  const styledResult = styles[selectedStyle];
  const showingStyled = Boolean(styledResult && !showBefore);
  const visibleDepth = useMemo(
    () => depthResult && showingStyled && styledResult
      ? { ...depthResult, backgroundUrl: styledResult.renderBackgroundUrl }
      : depthResult,
    [depthResult, showingStyled, styledResult],
  );
  const visibleBackgroundUrl = showingStyled && styledResult
    ? (depthResult ? styledResult.renderBackgroundUrl : styledResult.backgroundUrl)
    : (depthResult?.backgroundUrl || result?.sourceUrl || "");

  useEffect(() => {
    if (visibleDepth) setSpatialReady(false);
  }, [visibleDepth]);

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
                Hold the photo to wake the scene. The subject stays beyond the
                frame.
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
              className={`photo-stage ${spatialReady && !prefersReducedMotion ? "spatial-ready" : ""} ${holding ? "is-awake" : ""}`}
              style={previewStyle}
              ref={photoStageRef}
              onPointerDown={startHold}
              onPointerUp={endHold}
              onPointerCancel={endHold}
              onLostPointerCapture={() => setHolding(false)}
              aria-label={
                spatialReady && !prefersReducedMotion
                  ? "Interactive spatial photo. Hold to animate."
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
                        backgroundMode={showingStyled ? "sky-plane" : "photo-depth"}
                        stage={photoStageRef}
                        active={holding}
                        travelScale={touchesImageEdge ? 0.45 : 1}
                        onReady={() => setSpatialReady(true)}
                        onUnavailable={(message) => {
                          setDepthError(message);
                          setSpatialReady(false);
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
              <span className="style-studio-note">AI sky + your original subject. Best with open-sky photos.</span>
            </div>
            <div className="style-choices">
              {styleOptions.map((option) => (
                <button
                  key={option.id}
                  className={`style-choice ${selectedStyle === option.id ? "selected" : ""}`}
                  onClick={() => { setSelectedStyle(option.id); setShowBefore(false); setGenerationError(""); }}
                  aria-pressed={selectedStyle === option.id}
                >
                  <span className={`style-swatch ${option.id}`} />
                  <span><strong>{option.name}</strong><small>{option.detail}</small></span>
                  {styles[option.id] && <Check size={16} aria-label="Generated" />}
                </button>
              ))}
            </div>
            <div className="style-actions">
              <button className="style-primary" onClick={() => void generateStyle()} disabled={generating}>
                {generating ? <span className="loading-spinner" /> : <Sparkles size={17} />}
                {generating ? (restyleStageLabels[generationStage] || "Generating your background") : styledResult ? "Show result" : "Generate background"}
              </button>
              <button className="action-button" onClick={() => setShowBefore(!showBefore)} disabled={!styledResult}>
                {showBefore ? "View after" : "View before"}
              </button>
              <button className="action-button" onClick={() => void downloadPng()} disabled={!styledResult || generating || showBefore || showMask}>
                <Download size={17} /> Download PNG
              </button>
            </div>
            {generating && <p className="style-status" role="status">{restyleStageLabels[generationStage] || "Generating"} · First use downloads model weights and can take several minutes.</p>}
            {generationError && <p className="style-error" role="alert">{generationError}</p>}
            {exportError && <p className="style-error" role="alert">{exportError}</p>}
            <p className="style-status">PNG saves the centered, still composition. {selectedStyle === "cinematic-night" ? "Night is a stylized composite; your subject keeps its original lighting." : "The whole background becomes sky; original scene layout is not retained."}</p>
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
                onClick={() => setShowMask(!showMask)}
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
            {depthError
              ? `Static preview available. Spatial analysis: ${depthError}`
              : spatialReady
                ? prefersReducedMotion
                  ? "Spatial preview ready · Motion is reduced in your system settings."
                  : "HOLD TO LIVE · Press and hold the photo; release to settle."
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
                <small>Hold to wake the scene</small>
              </div>
            </div>
          </div>
        </main>
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
