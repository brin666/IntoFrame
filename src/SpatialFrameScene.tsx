import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { DepthResult, Result } from "./api";
import { calculateParallax, subjectZ, SKY_Z } from "./parallax";

const CAMERA_DISTANCE = 3.5;
const FOV = 35;
const DEPTH_SPAN = 0.62;

interface Props {
  depth: DepthResult;
  backgroundMode?: "photo-depth" | "sky-layers";
  result: Result;
  zoom: number;
  shiftX: number;
  touch: boolean;
  onMotionNotice: (notice: string) => void;
  stage: RefObject<HTMLDivElement | null>;
  active: boolean;
  travelScale: number;
  onReady: (renderedDepth: DepthResult) => void;
  onUnavailable: (message: string) => void;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`Could not load spatial asset: ${src}`));
    image.src = src;
  });
}

/** A depth-relief photo: centered camera reproduces the original image exactly at vertices. */
export function SpatialFrameScene({
  depth,
  backgroundMode = "photo-depth",
  result,
  zoom,
  shiftX,
  touch,
  onMotionNotice,
  stage,
  active,
  travelScale,
  onReady,
  onUnavailable,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const onUnavailableRef = useRef(onUnavailable);
  const onReadyRef = useRef(onReady);
  const motionRef = useRef({ result, zoom, shiftX, touch, onMotionNotice });
  motionRef.current = { result, zoom, shiftX, touch, onMotionNotice };
  activeRef.current = active;
  onUnavailableRef.current = onUnavailable;
  onReadyRef.current = onReady;

  useEffect(() => {
    const element = host.current;
    const stageElement = stage.current;
    if (!element || !stageElement) return;
    let cancelled = false;
    let frame = 0;
    let renderer: THREE.WebGLRenderer | undefined;
    let geometry: THREE.PlaneGeometry | undefined;
    let material: THREE.MeshBasicMaterial | undefined;
    let texture: THREE.Texture | undefined;
    let observer: ResizeObserver | undefined;
    const extraResources: { geometry: THREE.PlaneGeometry; material: THREE.MeshBasicMaterial; texture: THREE.Texture }[] = [];

    async function setup() {
      try {
        const layered = backgroundMode === "sky-layers";
        if (layered && (!depth.renderSkyUrl || !depth.renderSceneUrl))
          throw new Error("The current sky layers are missing. Generate this photo again.");
        const [background, depthImage, preservedScene] = await Promise.all([
          loadImage(layered ? depth.renderSkyUrl! : depth.backgroundUrl),
          backgroundMode === "photo-depth" ? loadImage(depth.renderDepthUrl) : Promise.resolve(null),
          layered ? loadImage(depth.renderSceneUrl!) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        if (
          background.width !== depth.renderWidth ||
          background.height !== depth.renderHeight ||
          (depthImage && (depthImage.width !== depth.renderWidth ||
          depthImage.height !== depth.renderHeight)) ||
          (preservedScene && (preservedScene.width !== depth.renderWidth || preservedScene.height !== depth.renderHeight))
        ) {
          throw new Error("Spatial image and depth coordinates do not match.");
        }
        let pixels: Uint8ClampedArray | null = null;
        if (depthImage) {
          const sampleCanvas = document.createElement("canvas");
          sampleCanvas.width = depth.renderWidth;
          sampleCanvas.height = depth.renderHeight;
          const context = sampleCanvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("Canvas depth sampling is unavailable.");
          context.drawImage(depthImage, 0, 0);
          pixels = context.getImageData(0, 0, depth.renderWidth, depth.renderHeight).data;
        }

        const width = element!.clientWidth;
        const height = element!.clientHeight;
        if (width < 1 || height < 1)
          throw new Error("The spatial viewport has no size.");
        const visibleHeight =
          2 * CAMERA_DISTANCE * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
        const visibleWidth = (visibleHeight * width) / height;
        const planeWidth = (visibleWidth * depth.renderWidth) / depth.width;
        const planeHeight = (visibleHeight * depth.renderHeight) / depth.height;
        // The model PNG is 8-bit grayscale. Sample in its native padded coordinate system.
        const segmentsX = layered ? 1 : Math.min(
          96,
          Math.max(48, Math.round(depth.width / 12)),
        );
        const segmentsY = layered ? 1 : Math.min(
          96,
          Math.max(48, Math.round(depth.height / 12)),
        );
        geometry = new THREE.PlaneGeometry(
          planeWidth,
          planeHeight,
          segmentsX,
          segmentsY,
        );
        const positions = geometry.attributes.position;
        const uvs = geometry.attributes.uv;
        for (let i = 0; i < positions.count; i++) {
          const u = uvs.getX(i);
          const v = uvs.getY(i);
          const px = Math.min(
            depth.renderWidth - 1,
            Math.max(0, Math.round(u * (depth.renderWidth - 1))),
          );
          const py = Math.min(
            depth.renderHeight - 1,
            Math.max(0, Math.round((1 - v) * (depth.renderHeight - 1))),
          );
          // Generated sky has no correspondence to the replaced photo geometry.
          const near = pixels ? pixels[(py * depth.renderWidth + px) * 4] / 255 : 0;
          const z = layered ? SKY_Z : near * DEPTH_SPAN;
          // At rest, project every displaced vertex back to its original image coordinate.
          const compensation = (CAMERA_DISTANCE - z) / CAMERA_DISTANCE;
          positions.setXYZ(
            i,
            positions.getX(i) * compensation,
            positions.getY(i) * compensation,
            z,
          );
        }
        positions.needsUpdate = true;
        geometry.computeVertexNormals();
        texture = new THREE.Texture(background);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        material = new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.DoubleSide,
        });
        const scene = new THREE.Scene();
        scene.add(new THREE.Mesh(geometry, material));
        const foregroundZ = subjectZ(depth.foregroundDepth);
        if (preservedScene) {
          // Preserve scene supports at the subject's virtual depth. This is a
          // deliberate two-layer approximation, with no triangles bridging a
          // building/sky discontinuity and no inherited old sky depth relief.
          const compensation = (CAMERA_DISTANCE - foregroundZ) / CAMERA_DISTANCE;
          const g = new THREE.PlaneGeometry(planeWidth * compensation, planeHeight * compensation);
          const t = new THREE.Texture(preservedScene);
          t.colorSpace = THREE.SRGBColorSpace;
          t.minFilter = t.magFilter = THREE.LinearFilter;
          t.needsUpdate = true;
          const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
          const mesh = new THREE.Mesh(g, m);
          mesh.position.z = foregroundZ;
          scene.add(mesh);
          extraResources.push({ geometry: g, texture: t, material: m });
        }
        const camera = new THREE.PerspectiveCamera(
          FOV,
          width / height,
          0.1,
          100,
        );
        camera.position.z = CAMERA_DISTANCE;
        renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        });
        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        renderer.setSize(width, height);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.setAttribute("aria-hidden", "true");
        renderer.domElement.dataset.backgroundUrl = depth.backgroundUrl;
        renderer.domElement.dataset.skyUrl = depth.renderSkyUrl || "";
        renderer.domElement.dataset.sceneUrl = depth.renderSceneUrl || "";
        renderer.domElement.style.visibility = "hidden";
        element!.appendChild(renderer.domElement);

        let needsFirstFrame = true;
        const resize = () => {
          if (!renderer || !element) return;
          const w = element.clientWidth;
          const h = element.clientHeight;
          if (w < 1 || h < 1) return;
          // The stage keeps the source aspect ratio; update projection for responsive width.
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
          needsFirstFrame = true;
        };
        observer = new ResizeObserver(resize);
        observer.observe(element!);

        let cameraX = 0;
        let velocityX = 0;
        let wake = 0;
        let lastTime = performance.now();
        let awakeSince = lastTime;
        let previousNotice = "";
        const prefersReduced = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        );

        function render(now: number) {
          if (cancelled || !renderer) return;
          const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
          lastTime = now;
          const isAwake = activeRef.current && !prefersReduced.matches;
          if (!isAwake) awakeSince = now;
          const phase = (now - awakeSince) / 1000;
          const motion = motionRef.current;
          const travel = calculateParallax({
            width: element!.clientWidth, height: element!.clientHeight,
            zoom: motion.zoom, shiftX: motion.shiftX, sourceWidth: depth.width,
            paddingX: depth.padding, subjectBounds: motion.result.subjectBounds,
            subjectStats: motion.result.subjectStats, foregroundDepth: depth.foregroundDepth,
            touch: motion.touch, travelScale, backgroundZ: layered ? SKY_Z : 0,
          });
          const notice = layered ? travel.notice || "" : "";
          if (notice !== previousNotice) {
            previousNotice = notice;
            motion.onMotionNotice(notice);
          }
          const desiredWake = isAwake ? 1 : 0;
          wake +=
            (desiredWake - wake) * (1 - Math.exp(-dt * (isAwake ? 3.8 : 5.5)));
          const wave = 0.7 * Math.sin(phase * 1.35) + 0.3 * Math.sin(phase * 2.1);
          // At a source side cut, swing only away from the missing silhouette.
          // A squared wave gives a smooth return, including at direction changes.
          const targetX = !isAwake ? 0 : travel.leftTravel < 1e-8
            ? travel.rightTravel * wave * wave * wake
            : travel.rightTravel < 1e-8
              ? -travel.leftTravel * wave * wave * wake
              : wave * (wave < 0 ? travel.leftTravel : travel.rightTravel) * wake;
          // Critically damped camera spring. Position and velocity remain continuous on release.
          const omega = isAwake ? (motion.touch ? 6 : 7) : 8;
          velocityX +=
            ((targetX - cameraX) * omega * omega - 2 * omega * velocityX) * dt;
          cameraX += velocityX * dt;
          // Recalculate limits on resize/crop; the spring must never overshoot
          // into a source cut even while settling from a previous composition.
          const boundedX = Math.max(-travel.leftTravel, Math.min(travel.rightTravel, cameraX));
          if (boundedX !== cameraX) velocityX = 0;
          cameraX = boundedX;
          camera.position.x = cameraX;
          camera.position.z = CAMERA_DISTANCE - wake * 0.035;
          if (
            needsFirstFrame ||
            isAwake ||
            wake > 0.0001 ||
            Math.abs(cameraX) > 0.0001 ||
            Math.abs(velocityX) > 0.0001
          ) {
            renderer.render(scene, camera);
            if (renderer.domElement.style.visibility === "hidden") {
              renderer.domElement.style.visibility = "visible";
              onReadyRef.current(depth);
            }
            // Foreground stays in the DOM above the bars; its movement uses the same projection.
            const focalPixels =
              element!.clientHeight /
              (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
            const screenX =
              (-focalPixels * cameraX) / (camera.position.z - foregroundZ);
            const foregroundScale =
              (CAMERA_DISTANCE - foregroundZ) /
              (camera.position.z - foregroundZ);
            stageElement!.style.setProperty(
              "--subject-parallax-x",
              `${screenX.toFixed(3)}px`,
            );
            stageElement!.style.setProperty(
              "--subject-parallax-scale",
              foregroundScale.toFixed(5),
            );
            stageElement!.style.setProperty("--wake", wake.toFixed(4));
            stageElement!.dataset.cameraX = cameraX.toFixed(5);
            stageElement!.dataset.skyZ = (layered ? SKY_Z : 0).toString();
            stageElement!.dataset.targetGap = travel.targetGap.toFixed(2);
            needsFirstFrame = false;
          }
          frame = requestAnimationFrame(render);
        }
        frame = requestAnimationFrame(render);
      } catch (cause) {
        if (!cancelled)
          onUnavailableRef.current(
            cause instanceof Error
              ? cause.message
              : "Spatial rendering is unavailable.",
          );
      }
    }
    void setup();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      renderer?.dispose();
      renderer?.domElement.remove();
      geometry?.dispose();
      material?.dispose();
      texture?.dispose();
      extraResources.forEach(({ geometry: g, material: m, texture: t }) => { g.dispose(); m.dispose(); t.dispose(); });
      stageElement.style.removeProperty("--subject-parallax-x");
      stageElement.style.removeProperty("--subject-parallax-scale");
      stageElement.style.removeProperty("--wake");
      delete stageElement.dataset.cameraX;
      delete stageElement.dataset.skyZ;
      delete stageElement.dataset.targetGap;
    };
  }, [depth, backgroundMode, stage, travelScale]);

  return <div className="spatial-canvas" ref={host} data-background-mode={backgroundMode} />;
}
