import { FILM_BAR_FRACTION } from "../frameComposition";

export const PHOTO_REVEAL_FPS = 30;
export const PHOTO_REVEAL_DURATION = 180;
export const PHOTO_REVEAL_LAST_FRAME = PHOTO_REVEAL_DURATION - 1;

export interface RevealPose {
  zoom: number;
  shiftX: number;
  shiftY: number;
}

export type RevealPhase = "original" | "restyle" | "bars" | "hold";

export interface RevealTimelineState extends RevealPose {
  frame: number;
  phase: RevealPhase;
  poseProgress: number;
  styleProgress: number;
  barProgress: number;
  barFraction: number;
}

function progress(frame: number, start: number, end: number): number {
  const linear = Math.max(0, Math.min(1, (frame - start) / (end - start)));
  // A bounded ease with zero velocity at each endpoint, without overshoot.
  return linear * linear * (3 - 2 * linear);
}

/** A six-second planar reveal. All image layers share this exact pose. */
export function getRevealTimeline(
  currentFrame: number,
  finalPose: RevealPose,
): RevealTimelineState {
  const frame = Math.max(0, Math.min(PHOTO_REVEAL_LAST_FRAME, currentFrame));
  const poseProgress = progress(frame, 24, 90);
  const styleProgress = progress(frame, 30, 90);
  const barProgress = progress(frame, 90, 144);
  return {
    frame,
    phase:
      frame < 24
        ? "original"
        : frame < 90
          ? "restyle"
          : frame < 144
            ? "bars"
            : "hold",
    poseProgress,
    styleProgress,
    barProgress,
    barFraction: FILM_BAR_FRACTION * barProgress,
    // Keep the endpoint exact rather than obtaining it through subtraction.
    zoom:
      poseProgress === 1
        ? finalPose.zoom
        : 1 + (finalPose.zoom - 1) * poseProgress,
    shiftX:
      poseProgress === 0
        ? 0
        : poseProgress === 1
          ? finalPose.shiftX
          : finalPose.shiftX * poseProgress,
    shiftY:
      poseProgress === 0
        ? 0
        : poseProgress === 1
          ? finalPose.shiftY
          : finalPose.shiftY * poseProgress,
  };
}

/** Same native image rectangle used by exportFrame.ts. */
export function getRevealImageRect(
  width: number,
  height: number,
  pose: RevealPose,
): { left: number; top: number; width: number; height: number } {
  return {
    left: width * ((1 - pose.zoom) / 2 + pose.shiftX),
    top: height * ((1 - pose.zoom) / 2 + pose.shiftY),
    width: width * pose.zoom,
    height: height * pose.zoom,
  };
}
