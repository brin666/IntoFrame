import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
} from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ImagePlus,
  RotateCcw,
  ScanLine,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { createJob, getJob, type Result } from "./api";

type Mode = "upload" | "processing" | "preview" | "error";
const supported = ["image/jpeg", "image/png", "image/webp"];
const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));
const stageLabels: Record<string, string> = {
  queued: "Waiting for the image engine",
  preparing: "Preparing your image",
  segmenting: "Finding your subject",
};

function App() {
  const [mode, setMode] = useState<Mode>("upload");
  const [stage, setStage] = useState("queued");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [filename, setFilename] = useState("");
  const [zoom, setZoom] = useState(1);
  const [showMask, setShowMask] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);

  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );

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
    setFilename(file.name);
    setError("");
    setResult(null);
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
    setResult(null);
    setError("");
    setMode("upload");
  }

  const horizontalLimit = (zoom - 1) / 2;
  const verticalLimit = horizontalLimit + 0.13;
  const xShift = result
    ? clamp(
        -zoom * (result.composition.focusX - 0.5),
        -horizontalLimit,
        horizontalLimit,
      )
    : 0;
  const yShift = result
    ? clamp(
        -0.08 - zoom * (result.composition.focusY - 0.5),
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
      } as CSSProperties)
    : undefined;

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
            <span className="phase-dot" /> STATIC STUDIO
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
                The subject steps outside the cinematic crop. Fine-tune the
                composition below.
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
            <div className="photo-stage" style={previewStyle}>
              <div className="scene-layer background-layer">
                <img
                  src={result.sourceUrl}
                  alt="Original photograph"
                  draggable="false"
                />
              </div>
              <div className="letterbox letterbox-top" />
              <div className="letterbox letterbox-bottom" />
              <div className="scene-layer subject-layer">
                <img
                  src={result.subjectUrl}
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
          <p className="phase-note">
            Static break the frame preview · Depth and hold-to-live arrive in
            the next build.
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
              One ordinary image. A subject that steps beyond the frame. A new
              way to feel the moment.
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
                <small>Interactive depth coming next</small>
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
