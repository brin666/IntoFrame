import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { DepthResult, Result } from "./api";
import { calculateParallax, subjectZ, CAMERA_DISTANCE, DEPTH_SPAN, FOV, SKY_Z } from "./parallax";
import { createDepthSurface, createPhotoGeometryData, decodeMeshDepth,
  type DepthSurface, type PhotoGeometryData } from "./depthGeometry";
import { advanceSceneMotion, createSceneMotion, AUTO_TRAVEL_RATIO,
  type SceneInteraction } from "./sceneMotion";

interface Props {
  depth: DepthResult;
  backgroundMode?: "photo-depth" | "sky-layers";
  result: Result;
  subjectUrl?: string;
  zoom: number;
  shiftX: number;
  interaction: RefObject<SceneInteraction>;
  onMotionNotice: (notice: string) => void;
  stage: RefObject<HTMLDivElement | null>;
  autonomousEnabled: boolean;
  travelScale: number;
  onReady: (renderedDepth: DepthResult) => void;
  onUnavailable: (message: string) => void;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load a spatial image."));
    image.src = src;
  });
}

function imagePixels(image: HTMLImageElement): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas depth sampling is unavailable.");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function bufferGeometry(data: PhotoGeometryData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(data.uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function flatSurface(depth: DepthResult, z: number): DepthSurface {
  return { width: depth.width, height: depth.height, columns: 2, rows: 2,
    depths: new Float32Array([z, z, z, z]), referenceZ: z, nearestZ: z, farthestZ: z };
}

/** Perspective compensation + affine screen UVs reproduce the source at rest. */
function photoMaterial(image: HTMLImageElement, transparent: boolean): {
  material: THREE.MeshBasicMaterial; texture: THREE.Texture;
} {
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent,
    alphaTest: transparent ? 0.001 : 0, side: THREE.DoubleSide });
  // Cancel hardware perspective UV interpolation too: compensated vertices
  // and triangle interiors reproduce the still photo without depth seams.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying float vPhotoW;\n${shader.vertexShader}`.replace(
      "#include <project_vertex>",
      "#include <project_vertex>\nvPhotoW = gl_Position.w;\nvMapUv *= vPhotoW;",
    );
    shader.fragmentShader = `varying float vPhotoW;\n${shader.fragmentShader}`.replace(
      "#include <map_fragment>", THREE.ShaderChunk.map_fragment.replace(
        "texture2D( map, vMapUv )", "texture2D( map, vMapUv / vPhotoW )",
      ),
    );
  };
  material.customProgramCacheKey = () => "photo-screen-uv-v1";
  return { material, texture };
}

/** A shared camera renders the aperture background and full-stage alpha subject. */
export function SpatialFrameScene({ depth, backgroundMode = "photo-depth", result,
  subjectUrl = result.subjectUrl, zoom, shiftX, interaction, onMotionNotice, stage,
  autonomousEnabled, travelScale, onReady, onUnavailable }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const enabledRef = useRef(autonomousEnabled);
  const onUnavailableRef = useRef(onUnavailable);
  const onReadyRef = useRef(onReady);
  const motionRef = useRef({ result, zoom, shiftX, onMotionNotice });
  motionRef.current = { result, zoom, shiftX, onMotionNotice };
  enabledRef.current = autonomousEnabled;
  onUnavailableRef.current = onUnavailable;
  onReadyRef.current = onReady;

  useEffect(() => {
    const element = host.current;
    const stageElement = stage.current;
    if (!element || !stageElement) return;
    let cancelled = false;
    let unavailable = false;
    let frame = 0;
    let renderer: THREE.WebGLRenderer | undefined;
    let subjectRenderer: THREE.WebGLRenderer | undefined;
    let subjectLayer: HTMLDivElement | undefined;
    let observer: ResizeObserver | undefined;
    let contextLostHandler: (() => void) | undefined;
    const abort = new AbortController();
    const resources: { geometry: THREE.BufferGeometry; material: THREE.MeshBasicMaterial;
      texture: THREE.Texture }[] = [];
    stageElement.dataset.subjectGeometry = "flat-fallback";

    const restoreFallback = (message: string) => {
      if (cancelled || unavailable) return;
      unavailable = true;
      cancelAnimationFrame(frame);
      if (renderer) renderer.domElement.style.visibility = "hidden";
      if (subjectLayer) subjectLayer.style.display = "none";
      if (subjectRenderer) subjectRenderer.domElement.style.visibility = "hidden";
      stageElement.dataset.subjectGeometry = "flat-fallback";
      stageElement.style.removeProperty("--subject-parallax-x");
      stageElement.style.removeProperty("--subject-parallax-scale");
      stageElement.style.removeProperty("--wake");
      stageElement.dataset.cameraX = "0.00000";
      stageElement.dataset.cameraTargetX = "0.00000";
      stageElement.dataset.motionMode = "paused";
      interaction.current.active = false;
      interaction.current.deltaX = 0;
      onUnavailableRef.current(message);
    };

    async function setup() {
      try {
        const layered = backgroundMode === "sky-layers";
        if (layered && (!depth.renderSkyUrl || !depth.renderSceneUrl))
          throw new Error("The current sky layers are missing. Generate this photo again.");
        const [background, legacyDepth, preservedScene, subjectAsset] = await Promise.all([
          loadImage(layered ? depth.renderSkyUrl! : depth.backgroundUrl),
          layered ? Promise.resolve(null) : loadImage(depth.renderDepthUrl),
          layered ? loadImage(depth.renderSceneUrl!) : Promise.resolve(null),
          loadImage(subjectUrl).catch(() => null),
        ]);
        if (cancelled) return;
        if ([background, legacyDepth, preservedScene].some((image) => image &&
          (image.naturalWidth !== depth.renderWidth || image.naturalHeight !== depth.renderHeight)))
          throw new Error("Spatial image and depth coordinates do not match.");
        const width = element!.clientWidth;
        const height = element!.clientHeight;
        if (width < 1 || height < 1) throw new Error("The spatial viewport has no size.");
        const aspect = width / height;
        const foregroundZ = subjectZ(depth.foregroundDepth);
        let surface: DepthSurface | undefined;
        let degradation = "";
        try {
          if (depth.meshDepthDiagnostics?.eligible === false)
            throw new Error(depth.meshDepthDiagnostics.reason || "The subject depth range is unreliable.");
          if (!depth.meshDepthUrl || !depth.meshDepthMetadata)
            throw new Error("Native subject depth is missing. Reprocess this photo to enable local depth.");
          if (!subjectAsset || subjectAsset.naturalWidth !== depth.width ||
            subjectAsset.naturalHeight !== depth.height)
            throw new Error("The subject texture does not match the native depth.");
          const response = await fetch(depth.meshDepthUrl, { signal: abort.signal });
          if (!response.ok) throw new Error("Native subject depth could not be loaded.");
          const raw = decodeMeshDepth(await response.arrayBuffer(), depth.meshDepthMetadata,
            depth.width, depth.height);
          if (cancelled) return;
          let coverage: Uint8Array | undefined;
          if (preservedScene) {
            const subjectPixels = imagePixels(subjectAsset);
            const scenePixels = imagePixels(preservedScene);
            coverage = new Uint8Array(depth.width * depth.height);
            for (let y = 0; y < depth.height; y++) {
              for (let x = 0; x < depth.width; x++) {
                const i = y * depth.width + x;
                const padded = (y + depth.padding.top) * depth.renderWidth + x + depth.padding.left;
                coverage[i] = Math.max(subjectPixels[i * 4 + 3], scenePixels[padded * 4 + 3]);
              }
            }
          }
          surface = createDepthSurface(raw, depth.meshDepthMetadata, depth.foregroundDepth, coverage);
        } catch (cause) {
          if (cancelled) return;
          degradation = `Local depth is unavailable. ${cause instanceof Error ? cause.message : "The native depth could not be read."}`;
        }

        const backgroundScene = new THREE.Scene();
        const subjectScene = new THREE.Scene();
        const addPhoto = (scene: THREE.Scene, image: HTMLImageElement,
          data: PhotoGeometryData, transparent: boolean) => {
          const geometry = bufferGeometry(data);
          const { material, texture } = photoMaterial(image, transparent);
          const mesh = new THREE.Mesh(geometry, material);
          mesh.frustumCulled = false;
          scene.add(mesh);
          resources.push({ geometry, material, texture });
          return mesh;
        };
        if (layered) {
          // Generated sky always remains a distant plane. Scene alpha excludes
          // the original sky, so it cannot inherit moving relief geometry.
          addPhoto(backgroundScene, background,
            createPhotoGeometryData(flatSurface(depth, SKY_Z), aspect, depth.padding), false);
          const retained = addPhoto(backgroundScene, preservedScene!,
            createPhotoGeometryData(surface || flatSurface(depth, foregroundZ), aspect, depth.padding), true);
          retained.renderOrder = 1;
        } else if (surface) {
          addPhoto(backgroundScene, background, createPhotoGeometryData(surface, aspect, depth.padding), false);
        } else {
          const pixels = imagePixels(legacyDepth!);
          const columns = Math.min(96, Math.max(48, Math.round(depth.width / 12))) + 1;
          const rows = Math.min(96, Math.max(48, Math.round(depth.height / 12))) + 1;
          const depths = new Float32Array(columns * rows);
          for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
            const px = Math.round(x / (columns - 1) * (depth.width - 1)) + depth.padding.left;
            const py = Math.round(y / (rows - 1) * (depth.height - 1)) + depth.padding.top;
            depths[y * columns + x] = pixels[(py * depth.renderWidth + px) * 4] / 255 * DEPTH_SPAN;
          }
          addPhoto(backgroundScene, background, createPhotoGeometryData({ width: depth.width,
            height: depth.height, columns, rows, depths, referenceZ: 0,
            nearestZ: DEPTH_SPAN, farthestZ: 0 }, aspect, depth.padding), false);
        }
        if (surface && subjectAsset)
          addPhoto(subjectScene, subjectAsset, createPhotoGeometryData(surface, aspect), true);

        const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 100);
        camera.position.z = CAMERA_DISTANCE;
        const createRenderer = () => {
          const instance = new THREE.WebGLRenderer({ alpha: true, antialias: true,
            powerPreference: "high-performance" });
          instance.setClearColor(0x000000, 0);
          instance.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
          instance.setSize(width, height);
          instance.outputColorSpace = THREE.SRGBColorSpace;
          instance.domElement.setAttribute("aria-hidden", "true");
          instance.domElement.style.visibility = "hidden";
          instance.debug.onShaderError = () => { throw new Error("The spatial image shader could not be compiled."); };
          return instance;
        };
        renderer = createRenderer();
        renderer.domElement.dataset.backgroundUrl = depth.backgroundUrl;
        renderer.domElement.dataset.skyUrl = depth.renderSkyUrl || "";
        renderer.domElement.dataset.sceneUrl = depth.renderSceneUrl || "";
        element!.appendChild(renderer.domElement);
        if (surface) {
          try {
            subjectRenderer = createRenderer();
            subjectRenderer.domElement.dataset.subjectUrl = subjectUrl;
            subjectLayer = document.createElement("div");
            subjectLayer.className = "subject-depth-layer";
            subjectLayer.setAttribute("aria-hidden", "true");
            subjectLayer.appendChild(subjectRenderer.domElement);
            stageElement!.appendChild(subjectLayer);
          } catch {
            degradation = "Local depth is unavailable because the subject renderer could not start.";
            subjectRenderer?.dispose();
            subjectRenderer = undefined;
            subjectLayer?.remove();
          }
        }
        contextLostHandler = () => {
          restoreFallback("Spatial rendering was interrupted. Reload this photo to restore motion.");
        };
        renderer.domElement.addEventListener("webglcontextlost", contextLostHandler);
        subjectRenderer?.domElement.addEventListener("webglcontextlost", contextLostHandler);

        let needsFirstFrame = true;
        const resize = () => {
          if (!renderer || !element) return;
          const w = element.clientWidth;
          const h = element.clientHeight;
          if (w < 1 || h < 1) return;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
          subjectRenderer?.setSize(w, h);
          needsFirstFrame = true;
        };
        observer = new ResizeObserver(resize);
        observer.observe(element!);

        const motionState = createSceneMotion();
        let lastTime = performance.now();
        let previousNotice: string | undefined;
        const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
        function render(now: number) {
          if (cancelled || unavailable || !renderer) return;
          try {
            const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
            lastTime = now;
            const motion = motionRef.current;
            const input = interaction.current;
            const isEnabled = enabledRef.current && Boolean(surface && subjectRenderer) &&
              !prefersReduced.matches && !document.hidden;
            const travel = calculateParallax({ width: element!.clientWidth,
              height: element!.clientHeight, zoom: motion.zoom, shiftX: motion.shiftX,
              sourceWidth: depth.width, paddingX: depth.padding,
              subjectBounds: motion.result.subjectBounds, subjectStats: motion.result.subjectStats,
              foregroundDepth: depth.foregroundDepth, touch: input.touch, travelScale,
              backgroundZ: layered ? SKY_Z : 0, subjectReferenceZ: surface?.referenceZ,
              nearestZ: surface?.nearestZ });
            const notice = [degradation, travel.notice].filter(Boolean).join(" ");
            if (notice !== previousNotice) {
              previousNotice = notice;
              motion.onMotionNotice(notice);
            }
            const previousCameraX = motionState.cameraX;
            const previousWake = motionState.wake;
            advanceSceneMotion(motionState, { dt, enabled: isEnabled, interaction: input,
              leftTravel: travel.leftTravel, rightTravel: travel.rightTravel });
            const { cameraX, wake } = motionState;
            camera.position.x = cameraX;
            camera.position.z = CAMERA_DISTANCE;
            // Interaction refs change without React renders. These diagnostics
            // describe the live controller and the limits it actually uses.
            stageElement!.dataset.motionMode = motionState.mode;
            stageElement!.dataset.cameraTargetX = motionState.targetX.toFixed(5);
            stageElement!.dataset.leftTravel = travel.leftTravel.toFixed(5);
            stageElement!.dataset.rightTravel = travel.rightTravel.toFixed(5);
            stageElement!.dataset.autoTravelRatio = AUTO_TRAVEL_RATIO.toString();
            if (needsFirstFrame || isEnabled || previousCameraX !== cameraX || previousWake !== wake) {
              if (renderer.getContext().isContextLost()) throw new Error("The spatial renderer lost its graphics context.");
              renderer.render(backgroundScene, camera);
              if (subjectRenderer) {
                try {
                  if (subjectRenderer.getContext().isContextLost()) throw new Error("Subject graphics context lost.");
                  subjectRenderer.render(subjectScene, camera);
                  if (subjectRenderer.info.render.calls < 1 || subjectRenderer.info.render.triangles < 1)
                    throw new Error("No subject geometry was drawn.");
                  subjectRenderer.domElement.style.visibility = "visible";
                  stageElement!.dataset.subjectGeometry = "depth-mesh";
                } catch {
                  subjectRenderer.dispose();
                  subjectRenderer.domElement.remove();
                  subjectRenderer = undefined;
                  subjectLayer?.remove();
                  stageElement!.dataset.subjectGeometry = "flat-fallback";
                  degradation = "Local depth is unavailable because the subject mesh could not be drawn.";
                  restoreFallback(degradation);
                  return;
                }
              }
              const focalPixels = element!.clientHeight / (2 * Math.tan(FOV * Math.PI / 360));
              stageElement!.style.setProperty("--subject-parallax-x",
                `${(-focalPixels * cameraX / (camera.position.z - foregroundZ)).toFixed(3)}px`);
              stageElement!.style.setProperty("--subject-parallax-scale",
                ((CAMERA_DISTANCE - foregroundZ) / (camera.position.z - foregroundZ)).toFixed(5));
              stageElement!.style.setProperty("--wake", wake.toFixed(4));
              stageElement!.dataset.cameraX = cameraX.toFixed(5);
              stageElement!.dataset.skyZ = (layered ? SKY_Z : 0).toString();
              stageElement!.dataset.targetGap = travel.targetGap.toFixed(2);
              stageElement!.dataset.nearestZ = (surface?.nearestZ ?? foregroundZ).toFixed(5);
              if (renderer.domElement.style.visibility === "hidden") {
                renderer.domElement.style.visibility = "visible";
                if (subjectRenderer) onReadyRef.current(depth);
                else onUnavailableRef.current(degradation || "Local subject depth is unavailable. The preview stays still.");
              }
              needsFirstFrame = false;
            }
            frame = requestAnimationFrame(render);
          } catch (cause) {
            restoreFallback(cause instanceof Error ? cause.message : "Spatial rendering is unavailable.");
          }
        }
        frame = requestAnimationFrame(render);
      } catch (cause) {
        restoreFallback(cause instanceof Error ? cause.message : "Spatial rendering is unavailable.");
      }
    }
    void setup();
    return () => {
      cancelled = true;
      abort.abort();
      cancelAnimationFrame(frame);
      observer?.disconnect();
      if (contextLostHandler) {
        renderer?.domElement.removeEventListener("webglcontextlost", contextLostHandler);
        subjectRenderer?.domElement.removeEventListener("webglcontextlost", contextLostHandler);
      }
      renderer?.dispose();
      subjectRenderer?.dispose();
      renderer?.domElement.remove();
      subjectLayer?.remove();
      resources.forEach(({ geometry, material, texture }) => {
        geometry.dispose(); material.dispose(); texture.dispose();
      });
      stageElement.style.removeProperty("--subject-parallax-x");
      stageElement.style.removeProperty("--subject-parallax-scale");
      stageElement.style.removeProperty("--wake");
      delete stageElement.dataset.cameraX;
      delete stageElement.dataset.skyZ;
      delete stageElement.dataset.targetGap;
      delete stageElement.dataset.nearestZ;
      delete stageElement.dataset.motionMode;
      delete stageElement.dataset.cameraTargetX;
      delete stageElement.dataset.leftTravel;
      delete stageElement.dataset.rightTravel;
      delete stageElement.dataset.autoTravelRatio;
      delete stageElement.dataset.subjectGeometry;
    };
  }, [depth, backgroundMode, subjectUrl, stage, travelScale, interaction]);

  return <div className="spatial-canvas" ref={host} data-background-mode={backgroundMode} />;
}
