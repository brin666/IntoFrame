import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  CAMERA_DISTANCE, FOV, createBackgroundGeometry, createSubjectGeometry,
  imagePixels, worldFrame, type DepthMetadata, type SubjectGeometry,
} from "./geometry";

type Mode = "flat" | "depth" | "debug";
type View = "left" | "center" | "right";
const DEFAULT_JOB = "d81c42515e92447b93fa4f0431d53eb7";

interface Controls { mode: Mode; view: View; strength: number; travel: number; holding: boolean }
interface Metrics { triangles: number; skipped: number; vertices: number }

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Missing asset: ${url}`));
    image.src = url;
  });
}

function ExperimentScene({ job, controls, onStatus, onMetrics }: {
  job: string;
  controls: Controls;
  onStatus: (status: string) => void;
  onMetrics: (metrics: Metrics) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const flatRef = useRef<HTMLImageElement>(null);
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  useEffect(() => {
    const stage = stageRef.current;
    const host = hostRef.current;
    if (!stage || !host) return;
    let disposed = false;
    let frame = 0;
    let renderer: THREE.WebGLRenderer | undefined;
    let backgroundGeometry: THREE.BufferGeometry | undefined;
    let subjectGeometry: SubjectGeometry | undefined;
    let backgroundTexture: THREE.Texture | undefined;
    let subjectTexture: THREE.Texture | undefined;
    let backgroundMaterial: THREE.MeshBasicMaterial | undefined;
    let subjectMaterial: THREE.MeshBasicMaterial | undefined;
    let debugMaterial: THREE.MeshNormalMaterial | undefined;

    async function start() {
      try {
        const base = `/media/${encodeURIComponent(job)}`;
        const [metadataResponse, binaryResponse, background, renderDepth, mask, subject] = await Promise.all([
          fetch(`${base}/subject-depth.json`),
          fetch(`${base}/subject-depth-f32.bin`),
          loadImage(`${base}/background.webp`),
          loadImage(`${base}/render-depth.png`),
          loadImage(`${base}/mask.png`),
          loadImage(`${base}/subject.png`),
        ]);
        if (!metadataResponse.ok || !binaryResponse.ok)
          throw new Error("Float32 depth is missing. Run scripts/prepare-subject-depth-experiment.py for this job.");
        const metadata = await metadataResponse.json() as DepthMetadata;
        const binary = await binaryResponse.arrayBuffer();
        if (disposed) return;
        if (metadata.encoding !== "float32-little-endian-row-major" ||
            binary.byteLength !== metadata.width * metadata.height * 4 ||
            mask.naturalWidth !== metadata.width || mask.naturalHeight !== metadata.height ||
            subject.naturalWidth !== metadata.width || subject.naturalHeight !== metadata.height ||
            background.naturalWidth !== renderDepth.naturalWidth ||
            background.naturalHeight !== renderDepth.naturalHeight)
          throw new Error("RGB, mask and float32 depth asset dimensions/encoding do not match.");
        stage!.style.aspectRatio = `${metadata.width} / ${metadata.height}`;
        const depth = new Float32Array(binary);
        const width = stage!.clientWidth;
        const height = stage!.clientHeight;
        if (width < 1 || height < 1) throw new Error("Experiment stage has no size");
        backgroundGeometry = createBackgroundGeometry(
          imagePixels(renderDepth), metadata.width, metadata.height,
          background.naturalWidth, background.naturalHeight, width, height,
        );
        subjectGeometry = createSubjectGeometry(depth, imagePixels(mask), metadata, width, height);
        onMetrics({
          triangles: subjectGeometry.userData.validTriangles,
          skipped: subjectGeometry.userData.skippedTriangles,
          vertices: subjectGeometry.attributes.position.count,
        });
        backgroundTexture = new THREE.Texture(background);
        backgroundTexture.colorSpace = THREE.SRGBColorSpace;
        backgroundTexture.needsUpdate = true;
        subjectTexture = new THREE.Texture(subject);
        subjectTexture.colorSpace = THREE.SRGBColorSpace;
        subjectTexture.needsUpdate = true;
        backgroundMaterial = new THREE.MeshBasicMaterial({ map: backgroundTexture, side: THREE.DoubleSide });
        subjectMaterial = new THREE.MeshBasicMaterial({
          map: subjectTexture, side: THREE.DoubleSide, transparent: true,
          alphaTest: 0.02, depthWrite: true,
        });
        debugMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide, wireframe: true });
        const backgroundScene = new THREE.Scene();
        backgroundScene.add(new THREE.Mesh(backgroundGeometry, backgroundMaterial));
        const subjectScene = new THREE.Scene();
        const subjectMesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(subjectGeometry, subjectMaterial);
        subjectScene.add(subjectMesh);
        const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.1, 100);
        camera.position.z = CAMERA_DISTANCE;
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
        renderer.autoClear = false;
        renderer.setClearColor(0, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
        renderer.setSize(width, height);
        renderer.domElement.setAttribute("aria-hidden", "true");
        host!.append(renderer.domElement);
        let cameraX = 0;
        let velocityX = 0;
        let wake = 0;
        let lastTime = performance.now();
        let awakeSince = lastTime;
        let previousStrength = Number.NaN;
        const foregroundZ = CAMERA_DISTANCE - 2.55;

        function render(now: number) {
          if (disposed || !renderer || !subjectGeometry) return;
          const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
          lastTime = now;
          const current = controlsRef.current;
          if (current.strength !== previousStrength) {
            subjectGeometry.userData.updateStrength(current.strength);
            previousStrength = current.strength;
          }
          if (!current.holding) awakeSince = now;
          const phase = (now - awakeSince) / 1000;
          const desiredWake = current.holding ? 1 : 0;
          wake += (desiredWake - wake) * (1 - Math.exp(-dt * (current.holding ? 3.8 : 5.5)));
          const fixed = current.view === "left" ? -1 : current.view === "right" ? 1 : 0;
          const target = current.holding
            ? current.travel * (0.72 * Math.sin(phase * 1.35) + 0.28 * Math.sin(phase * 2.1)) * wake
            : fixed * current.travel;
          const omega = current.holding ? 7 : 8;
          velocityX += ((target - cameraX) * omega * omega - 2 * omega * velocityX) * dt;
          cameraX += velocityX * dt;
          camera.position.set(cameraX, 0, CAMERA_DISTANCE - wake * 0.035);
          // Small tracking correction; lateral camera translation does the parallax.
          camera.lookAt(cameraX * 0.9, 0, 0);
          subjectMesh.material = current.mode === "debug" ? debugMaterial! : subjectMaterial!;
          renderer.setScissorTest(false);
          renderer.clear(true, true, true);
          renderer.setScissor(0, Math.round(height * 0.13), width,
            Math.round(height * 0.74));
          renderer.setScissorTest(true);
          renderer.render(backgroundScene, camera);
          renderer.setScissorTest(false);
          renderer.clearDepth();
          if (current.mode !== "flat") renderer.render(subjectScene, camera);
          const flat = flatRef.current;
          if (flat) {
            const focal = worldFrame(height, width).focalPixels;
            const shift = -focal * cameraX / (camera.position.z - foregroundZ);
            const scale = (CAMERA_DISTANCE - foregroundZ) / (camera.position.z - foregroundZ);
            flat.style.transform = `translateX(${shift.toFixed(3)}px) scale(${scale.toFixed(5)})`;
            flat.style.visibility = current.mode === "flat" ? "visible" : "hidden";
          }
          stage!.dataset.cameraX = cameraX.toFixed(5);
          stage!.dataset.mode = current.mode;
          stage!.style.setProperty("--wake", wake.toFixed(4));
          frame = requestAnimationFrame(render);
        }
        onStatus("Ready — hold the image or select a fixed view");
        frame = requestAnimationFrame(render);
      } catch (error) {
        if (!disposed) onStatus(error instanceof Error ? error.message : "Experiment failed to load");
      }
    }
    void start();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      renderer?.domElement.remove();
      renderer?.dispose();
      backgroundGeometry?.dispose();
      subjectGeometry?.dispose();
      backgroundTexture?.dispose();
      subjectTexture?.dispose();
      backgroundMaterial?.dispose();
      subjectMaterial?.dispose();
      debugMaterial?.dispose();
    };
  }, [job]);

  return <div className="experiment-stage" ref={stageRef}
    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); controls.holding = true; }}
    onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); controls.holding = false; }}
    onPointerCancel={() => { controls.holding = false; }}
    onLostPointerCapture={() => { controls.holding = false; }}
    onContextMenu={(event) => event.preventDefault()}
    aria-label="Subject depth experiment. Hold to animate camera movement."
  >
    <div className="experiment-bar experiment-bar-top" />
    <div className="experiment-bar experiment-bar-bottom" />
    <div className="experiment-canvas" ref={hostRef} />
    <img className="experiment-flat-subject" ref={flatRef}
      src={`/media/${encodeURIComponent(job)}/subject.png`} alt="Flat subject comparison" draggable={false} />
  </div>;
}

export default function ExperimentApp() {
  const job = new URLSearchParams(location.search).get("job") || DEFAULT_JOB;
  const [mode, setMode] = useState<Mode>("depth");
  const [view, setView] = useState<View>("center");
  const [strength, setStrength] = useState(1);
  const [travel, setTravel] = useState(0.06);
  const [status, setStatus] = useState("Loading float32 depth and mesh…");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const controlsRef = useRef<Controls>({ mode, view, strength, travel, holding: false });
  Object.assign(controlsRef.current, { mode, view, strength, travel });
  return <main className="experiment-page">
    <header className="experiment-header">
      <a href="/">← IntoFrame</a>
      <div><span className="experiment-eyebrow">PHASE 2.5 / ISOLATED LAB</span><h1>Subject Depth Mesh</h1></div>
      <span className="experiment-job">Big Ben · {job.slice(0, 8)}</span>
    </header>
    <div className="experiment-layout">
      <ExperimentScene job={job} controls={controlsRef.current} onStatus={setStatus} onMetrics={setMetrics} />
      <aside className="experiment-controls">
        <div className="experiment-group"><span>SUBJECT</span><div className="experiment-buttons">
          {(["flat", "depth", "debug"] as const).map((value) =>
            <button key={value} data-mode={value} className={mode === value ? "selected" : ""}
              onClick={() => setMode(value)}>{value === "flat" ? "A · Flat" : value === "depth" ? "B · Depth" : "C · Geometry"}</button>)}
        </div></div>
        <div className="experiment-group"><span>FIXED CAMERA VIEW</span><div className="experiment-buttons">
          {(["left", "center", "right"] as const).map((value) =>
            <button key={value} data-view={value} className={view === value ? "selected" : ""}
              onClick={() => setView(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
        </div></div>
        <label className="experiment-slider">Virtual relief <output>{strength.toFixed(2)}×</output>
          <input type="range" min="0" max="1.6" step="0.05" value={strength}
            onChange={(event) => setStrength(Number(event.target.value))} /></label>
        <label className="experiment-slider">Camera travel <output>{travel.toFixed(3)}</output>
          <input type="range" min="0.015" max="0.10" step="0.005" value={travel}
            onChange={(event) => setTravel(Number(event.target.value))} /></label>
        <p className="experiment-status" role="status">{status}</p>
        {metrics && <p className="experiment-metrics">{metrics.vertices.toLocaleString()} vertices · {metrics.triangles.toLocaleString()} triangles · {metrics.skipped.toLocaleString()} boundary/depth triangles removed</p>}
        <p className="experiment-note">Relative depth mapped to a bounded virtual camera distance. Center preserves source UVs. Hold image to sway; release settles to the selected fixed view.</p>
      </aside>
    </div>
  </main>;
}
