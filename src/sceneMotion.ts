export interface SceneInteraction {
  active: boolean;
  /** Horizontal movement since the press, as a fraction of preview width. */
  deltaX: number;
  gestureId: number;
  touch: boolean;
}

export type SceneMotionMode = "autonomous" | "drag" | "returning" | "paused";

export interface SceneMotionState {
  cameraX: number;
  velocityX: number;
  wake: number;
  phase: number;
  gestureId: number;
  /** Press position during a drag; the held target during the return. */
  dragOriginX: number;
  dragging: boolean;
  /** Remaining influence of the held target, from one to zero. */
  returnBlend: number;
  mode: SceneMotionMode;
  targetX: number;
}

export interface SceneMotionInput {
  dt: number;
  enabled: boolean;
  interaction: SceneInteraction;
  leftTravel: number;
  rightTravel: number;
}

const CYCLE = Math.PI * 2;
const PHASE_SPEED = CYCLE / 16;
export const AUTO_TRAVEL_RATIO = 0.35;
const AUTO_AMOUNT = AUTO_TRAVEL_RATIO;
const SPRING_SPEED = 12;
const RETURN_SECONDS = 0.45;
const WAKE_SPEED = 6;
const MAX_DT = 0.05;

export function createSceneMotion(): SceneMotionState {
  return {
    cameraX: 0,
    velocityX: 0,
    wake: 0,
    phase: 0,
    gestureId: 0,
    dragOriginX: 0,
    dragging: false,
    returnBlend: 0,
    mode: "autonomous",
    targetX: 0,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function pause(state: SceneMotionState): SceneMotionState {
  state.cameraX = 0;
  state.velocityX = 0;
  state.wake = 0;
  state.targetX = 0;
  state.dragOriginX = 0;
  state.dragging = false;
  state.returnBlend = 0;
  state.mode = "paused";
  if (!Number.isFinite(state.phase)) state.phase = 0;
  if (!Number.isFinite(state.gestureId)) state.gestureId = 0;
  return state;
}

function validInput(input: SceneMotionInput): boolean {
  const interaction = input?.interaction;
  return (
    Number.isFinite(input?.dt) &&
    input.dt >= 0 &&
    typeof input.enabled === "boolean" &&
    Number.isFinite(input.leftTravel) &&
    input.leftTravel >= 0 &&
    Number.isFinite(input.rightTravel) &&
    input.rightTravel >= 0 &&
    typeof interaction?.active === "boolean" &&
    Number.isFinite(interaction.deltaX) &&
    Number.isFinite(interaction.gestureId) &&
    typeof interaction.touch === "boolean"
  );
}

function validState(state: SceneMotionState): boolean {
  return [
    state.cameraX,
    state.velocityX,
    state.wake,
    state.phase,
    state.gestureId,
    state.dragOriginX,
    state.returnBlend,
    state.targetX,
  ].every(Number.isFinite);
}

function autonomousTarget(phase: number, left: number, right: number): number {
  if (left === 0 || right === 0) {
    // A one-sided crop starts at center with zero speed, then returns there.
    const wave = (1 - Math.cos(phase)) / 2;
    return wave === 0 ? 0 : AUTO_AMOUNT * (right - left) * wave;
  }
  const wave = Math.sin(phase);
  return AUTO_AMOUNT * wave * (wave < 0 ? left : right);
}

/** Exact critically damped spring for a target moving linearly this frame. */
function spring(
  state: SceneMotionState,
  previousTarget: number,
  dt: number,
): void {
  if (dt === 0) return;
  const target = state.targetX;
  const decay = Math.exp(-SPRING_SPEED * dt);
  const ramp = (target - previousTarget) / dt;
  // Tiny event intervals can make a ramp numerically ill-conditioned.
  if (dt < 1e-5 || target === previousTarget) {
    const offset = state.cameraX - target;
    const coefficient = state.velocityX + SPRING_SPEED * offset;
    state.cameraX = target + (offset + coefficient * dt) * decay;
    state.velocityX =
      (state.velocityX - SPRING_SPEED * coefficient * dt) * decay;
    return;
  }
  const offset = state.cameraX - previousTarget + (2 * ramp) / SPRING_SPEED;
  const relativeVelocity = state.velocityX - ramp;
  const coefficient = relativeVelocity + SPRING_SPEED * offset;
  state.cameraX =
    target - (2 * ramp) / SPRING_SPEED + (offset + coefficient * dt) * decay;
  state.velocityX =
    ramp + (relativeVelocity - SPRING_SPEED * coefficient * dt) * decay;
}

function constrain(state: SceneMotionState, left: number, right: number): void {
  state.cameraX = clamp(state.cameraX, -left, right);
  state.targetX = clamp(state.targetX, -left, right);
  state.dragOriginX = clamp(state.dragOriginX, -left, right);
  if (
    (state.cameraX <= -left && state.velocityX < 0) ||
    (state.cameraX >= right && state.velocityX > 0)
  )
    state.velocityX = 0;
}

/**
 * Advance only local horizontal motion. Travel limits come from the renderer's
 * existing crop calculation; this controller never enlarges those limits.
 * Press and release transitions retain the displayed position exactly.
 */
export function advanceSceneMotion(
  state: SceneMotionState,
  input: SceneMotionInput,
): SceneMotionState {
  if (!validInput(input) || !validState(state) || !input.enabled)
    return pause(state);
  const dt = Math.min(input.dt, MAX_DT);
  const left = input.leftTravel;
  const right = input.rightTravel;
  const interaction = input.interaction;
  constrain(state, left, right);
  const previousTarget = state.targetX;

  if (interaction.active) {
    const pressed =
      !state.dragging || state.gestureId !== interaction.gestureId;
    if (pressed) {
      state.velocityX = 0;
      state.dragOriginX = state.cameraX;
      state.gestureId = interaction.gestureId;
    }
    state.dragging = true;
    state.returnBlend = 0;
    state.mode = "drag";
    const available =
      interaction.deltaX > 0
        ? state.dragOriginX + left
        : right - state.dragOriginX;
    state.targetX = clamp(
      state.dragOriginX - interaction.deltaX * 3 * available,
      -left,
      right,
    );
    // The first press frame freezes the exact current view, even mid-spring.
    if (pressed) return validState(state) ? state : pause(state);
  } else {
    state.phase = ((state.phase % CYCLE) + CYCLE + dt * PHASE_SPEED) % CYCLE;
    if (state.dragging) {
      state.dragging = false;
      state.dragOriginX = state.targetX;
      state.returnBlend = 1;
      state.mode = "returning";
      // Keep position, spring velocity and wake on the release event itself.
      return state;
    }
    const autoTarget = autonomousTarget(state.phase, left, right);
    if (state.mode === "returning") {
      state.returnBlend *= Math.exp(-dt / RETURN_SECONDS);
      if (state.returnBlend < 0.01) {
        state.returnBlend = 0;
        state.mode = "autonomous";
      }
      state.targetX =
        state.dragOriginX * state.returnBlend +
        autoTarget * (1 - state.returnBlend);
    } else {
      state.mode = "autonomous";
      state.returnBlend = 0;
      state.targetX = autoTarget;
    }
    state.wake =
      AUTO_AMOUNT + (state.wake - AUTO_AMOUNT) * Math.exp(-WAKE_SPEED * dt);
  }

  spring(state, previousTarget, dt);
  if (!validState(state)) return pause(state);
  constrain(state, left, right);
  return state;
}
