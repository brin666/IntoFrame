import { createContext, useContext, type CSSProperties } from "react";
import { Img, useCurrentFrame } from "remotion";
import {
  getRevealImageRect,
  getRevealTimeline,
  PHOTO_REVEAL_LAST_FRAME,
  type RevealPose,
} from "./revealTimeline";

export interface PhotoRevealProps extends RevealPose {
  sourceUrl: string;
  backgroundUrl: string;
  subjectUrl: string;
  width: number;
  height: number;
}

/** Async image failures must reach the host as well as render-boundary failures. */
export const PhotoRevealErrorContext = createContext<
  ((message: string) => void) | null
>(null);

const fillStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  overflow: "hidden",
};

function RevealLayers({
  input,
  frame,
  playerImages,
}: {
  input: PhotoRevealProps;
  frame: number;
  playerImages: boolean;
}) {
  const reportFailure = useContext(PhotoRevealErrorContext);
  const state = getRevealTimeline(frame, input);
  const imageRect = getRevealImageRect(input.width, input.height, state);
  const imageStyle: CSSProperties = {
    position: "absolute",
    ...imageRect,
    maxWidth: "none",
    maxHeight: "none",
    display: "block",
    userSelect: "none",
  };
  const image = (url: string, layer: "source" | "background" | "subject") => {
    const shared = {
      src: url,
      alt: "",
      draggable: false,
      width: input.width,
      height: input.height,
      style: imageStyle,
      "data-reveal-layer": layer,
    };
    return playerImages ? (
      <Img
        {...shared}
        pauseWhenLoading
        maxRetries={0}
        onImageError={() => reportFailure?.("过渡图片加载失败，已恢复预览。")}
      />
    ) : (
      <img {...shared} />
    );
  };

  return (
    <div
      style={{
        ...fillStyle,
        backgroundColor: "#0b0c0d",
        pointerEvents: "none",
      }}
      data-photo-reveal="composition"
      data-reveal-frame={state.frame}
      data-reveal-phase={state.phase}
      data-reveal-style-progress={state.styleProgress}
      data-reveal-bar-fraction={state.barFraction}
      data-reveal-zoom={state.zoom}
      data-reveal-shift-x={state.shiftX}
      data-reveal-shift-y={state.shiftY}
    >
      {image(input.sourceUrl, "source")}
      {/* Composite first, then fade once: opaque subject pixels stay opaque. */}
      <div
        data-reveal-layer="styled-group"
        style={{
          ...fillStyle,
          backgroundColor: "#0b0c0d",
          opacity: state.styleProgress,
        }}
      >
        <div
          data-reveal-layer="background-clip"
          style={{
            ...fillStyle,
            clipPath: `inset(${input.height * state.barFraction}px 0)`,
          }}
        >
          {image(input.backgroundUrl, "background")}
        </div>
        {image(input.subjectUrl, "subject")}
      </div>
    </div>
  );
}

export function PhotoReveal(input: PhotoRevealProps) {
  const frame = useCurrentFrame();
  return <RevealLayers input={input} frame={frame} playerImages />;
}

/** Native-size final frame for still capture and comparison with PNG export. */
export function PhotoRevealStill(input: PhotoRevealProps) {
  return (
    <RevealLayers
      input={input}
      frame={PHOTO_REVEAL_LAST_FRAME}
      playerImages={false}
    />
  );
}
