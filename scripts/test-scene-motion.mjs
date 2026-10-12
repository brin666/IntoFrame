import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/sceneMotion.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
  reportDiagnostics: true,
});
assert.equal(
  compiled.diagnostics?.length ?? 0,
  0,
  "Controller has syntax diagnostics",
);
const { createSceneMotion, advanceSceneMotion } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`
);

const idle = { active: false, deltaX: 0, gestureId: 0, touch: false };
const defaults = {
  dt: 1 / 60,
  enabled: true,
  interaction: idle,
  leftTravel: 0.08,
  rightTravel: 0.12,
};
const cases = [];
function test(name, run) {
  run();
  cases.push(name);
}
function close(actual, expected, message, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${message}: ${actual} versus ${expected}`,
  );
}
function step(state, options = {}) {
  return advanceSceneMotion(state, { ...defaults, ...options });
}
function run(state, seconds, options = {}, dt = 1 / 60) {
  const count = Math.round(seconds / dt);
  for (let frame = 0; frame < count; frame++) step(state, { ...options, dt });
  return state;
}
function held(deltaX = 0, gestureId = 1, touch = false) {
  return { active: true, deltaX, gestureId, touch };
}
function bounded(
  state,
  left = defaults.leftTravel,
  right = defaults.rightTravel,
) {
  assert.ok(Number.isFinite(state.cameraX) && Number.isFinite(state.velocityX));
  assert.ok(
    state.cameraX >= -left && state.cameraX <= right,
    `Camera escaped: ${state.cameraX}`,
  );
  assert.ok(
    state.targetX >= -left && state.targetX <= right,
    `Target escaped: ${state.targetX}`,
  );
}

test("autonomous cycle is 16 seconds and uses 35 percent of each safe side", () => {
  for (const [leftTravel, rightTravel] of [
    [0.12, 0.12],
    [0.08, 0.12],
  ]) {
    const state = createSceneMotion();
    for (let frame = 1; frame <= 960; frame++) {
      step(state, { leftTravel, rightTravel });
      bounded(state, leftTravel, rightTravel);
      assert.ok(state.cameraX >= -leftTravel * 0.35 - 1e-10);
      assert.ok(state.cameraX <= rightTravel * 0.35 + 1e-10);
      if (frame === 240)
        close(state.targetX, rightTravel * 0.35, "Positive peak");
      if (frame === 720)
        close(state.targetX, -leftTravel * 0.35, "Negative peak");
    }
    close(Math.sin(state.phase), 0, "Complete cycle phase");
    close(state.targetX, 0, "Complete cycle target");
    assert.equal(state.mode, "autonomous");
    close(state.wake, 0.35, "Settled auto wake");
  }
});

test("one-sided auto starts at zero, remains safe and returns every 16 seconds", () => {
  for (const [leftTravel, rightTravel] of [
    [0, 0.12],
    [0.08, 0],
    [0, 0],
  ]) {
    const state = createSceneMotion();
    step(state, { dt: 0, leftTravel, rightTravel });
    assert.equal(state.cameraX, 0);
    assert.equal(state.targetX, 0);
    for (let frame = 1; frame <= 960; frame++) {
      step(state, { leftTravel, rightTravel });
      bounded(state, leftTravel, rightTravel);
      if (frame === 480)
        close(
          state.targetX,
          0.35 * (rightTravel - leftTravel),
          "One-sided peak",
        );
    }
    close(state.targetX, 0, "One-sided full cycle");
  }
});

test("press captures a moving camera exactly and a stationary hold freezes auto", () => {
  const state = run(createSceneMotion(), 2);
  assert.ok(state.cameraX > 0 && state.velocityX > 0);
  const camera = state.cameraX;
  const phase = state.phase;
  const wake = state.wake;
  step(state, { interaction: held() });
  assert.equal(state.cameraX, camera);
  assert.equal(state.velocityX, 0);
  assert.equal(state.dragOriginX, camera);
  assert.equal(state.targetX, camera);
  run(state, 5, { interaction: held() });
  close(state.cameraX, camera, "Stationary held position");
  assert.equal(state.phase, phase);
  assert.equal(state.targetX, camera);
  assert.equal(state.mode, "drag");
  assert.equal(state.wake, wake);
});

test("drag starts from the press origin with correct signs and bounded endpoints", () => {
  for (const deltaX of [-0.01, 0.01, -1 / 3, 1 / 3, -100, 100]) {
    const state = run(createSceneMotion(), 2);
    const origin = state.cameraX;
    step(state, { interaction: held() });
    step(state, { interaction: held(deltaX) });
    const available =
      deltaX > 0 ? origin + defaults.leftTravel : defaults.rightTravel - origin;
    const target = Math.max(
      -defaults.leftTravel,
      Math.min(defaults.rightTravel, origin - deltaX * 3 * available),
    );
    close(state.targetX, target, "Origin-based target");
    assert.ok(deltaX > 0 ? state.targetX < origin : state.targetX > origin);
    run(state, 2, { interaction: held(deltaX) });
    bounded(state);
    close(state.cameraX, target, "Settled drag", 1e-8);
  }
});

test("one-sided drags can return to center without crossing the cropped edge", () => {
  for (const [leftTravel, rightTravel, inwardDelta] of [
    [0, 0.12, 1 / 3],
    [0.08, 0, -1 / 3],
  ]) {
    const options = { leftTravel, rightTravel };
    const state = run(createSceneMotion(), 8, options);
    assert.ok(Math.abs(state.cameraX) > 0.02);
    step(state, { ...options, interaction: held(0, 1, true) });
    run(state, 2, { ...options, interaction: held(inwardDelta, 1, true) });
    close(state.targetX, 0, "Centerward one-sided drag");
    close(state.cameraX, 0, "Settled centerward drag", 1e-8);
    bounded(state, leftTravel, rightTravel);
    run(state, 2, { ...options, interaction: held(-inwardDelta, 1, true) });
    bounded(state, leftTravel, rightTravel);
    close(state.targetX, rightTravel - leftTravel, "Full safe direction");
  }
});

test("release preserves position and velocity, then blends toward bounded auto", () => {
  const state = createSceneMotion();
  step(state, { interaction: held() });
  run(state, 0.1, { interaction: held(-0.25) });
  const camera = state.cameraX;
  const velocity = state.velocityX;
  const target = state.targetX;
  const phase = state.phase;
  assert.ok(velocity > 0);
  step(state);
  assert.equal(state.cameraX, camera);
  assert.equal(state.velocityX, velocity);
  assert.equal(state.targetX, target);
  assert.equal(state.dragOriginX, target);
  assert.equal(state.returnBlend, 1);
  assert.equal(state.mode, "returning");
  assert.ok(state.phase > phase);
  run(state, 1);
  close(
    state.returnBlend,
    Math.exp(-1 / 0.45),
    "One-second exponential return",
  );
  assert.ok(state.targetX < target);
  for (let frame = 0; frame < 600; frame++) {
    step(state);
    bounded(state);
  }
  assert.equal(state.mode, "autonomous");
  assert.equal(state.returnBlend, 0);
  close(state.wake, 0.35, "Settled return wake");
});

test("wake starts at zero and preserves the full pose on press and release", () => {
  const state = createSceneMotion();
  assert.equal(state.wake, 0);
  run(state, 0.1);
  close(state.wake, 0.35 * (1 - Math.exp(-0.6)), "Wake eases from center");
  const wake = state.wake;
  const camera = state.cameraX;
  step(state, { interaction: held() });
  assert.equal(state.cameraX, camera);
  assert.equal(state.wake, wake);
  run(state, 1, { interaction: held(0.1) });
  assert.equal(state.wake, wake, "Held frames retain captured wake");
  const heldCamera = state.cameraX;
  const heldVelocity = state.velocityX;
  step(state);
  assert.equal(state.cameraX, heldCamera);
  assert.equal(state.velocityX, heldVelocity);
  assert.equal(state.wake, wake);
  step(state, { dt: 0 });
  assert.equal(state.wake, wake, "Zero-time return cannot change wake");
  step(state, { dt: 0.05 });
  close(state.wake, 0.35 + (wake - 0.35) * Math.exp(-0.3), "Return wake eases");
  const returningWake = state.wake;
  step(state, { interaction: held(0, 2) });
  assert.equal(state.wake, returningWake, "Repress retains return wake");
  step(state, { enabled: false, interaction: held(0, 2) });
  step(state, { dt: 0, interaction: held(0, 2) });
  run(state, 1, { interaction: held(0, 2) });
  assert.equal(state.wake, 0, "Reenabled held pointer stays at centered wake");
  step(state);
  assert.equal(state.wake, 0, "Release still retains centered wake");
  state.returnBlend = 0.0101;
  state.wake = 0.173;
  step(state, { dt: 0.05 });
  assert.equal(state.mode, "autonomous");
  close(
    state.wake,
    0.35 + (0.173 - 0.35) * Math.exp(-0.3),
    "Mode threshold cannot jump wake",
  );
});

test("release hands back to autonomous motion within 2.2 seconds continuously", () => {
  for (const deltaX of [-1 / 3, 1 / 3]) {
    const state = createSceneMotion();
    step(state, { interaction: held() });
    run(state, 2, { interaction: held(deltaX) });
    const heldCamera = state.cameraX;
    step(state);
    assert.equal(state.cameraX, heldCamera);
    let handoff = false;
    for (let frame = 0; frame < 132; frame++) {
      const camera = state.cameraX;
      const target = state.targetX;
      const mode = state.mode;
      step(state);
      bounded(state);
      assert.ok(
        Math.abs(state.cameraX - camera) < 0.003,
        "Return has no camera jump",
      );
      if (mode === "returning" && state.mode === "autonomous") {
        handoff = true;
        assert.ok(
          Math.abs(state.targetX - target) < 0.002,
          "Handoff target stays close",
        );
      }
    }
    assert.ok(handoff, "Return has a finite handoff");
    assert.equal(state.mode, "autonomous");
    assert.equal(state.returnBlend, 0);
  }
});

test("a new gesture during drag or return captures the current position", () => {
  const state = createSceneMotion();
  step(state, { interaction: held() });
  run(state, 0.2, { interaction: held(0.2) });
  let camera = state.cameraX;
  step(state, { interaction: held(0, 2) });
  assert.equal(state.cameraX, camera);
  assert.equal(state.dragOriginX, camera);
  assert.equal(state.velocityX, 0);
  run(state, 0.1, { interaction: held(-0.2, 2) });
  step(state);
  run(state, 0.2);
  camera = state.cameraX;
  step(state, { interaction: held(0, 3) });
  assert.equal(state.cameraX, camera);
  assert.equal(state.dragOriginX, camera);
  assert.equal(state.targetX, camera);
  assert.equal(state.velocityX, 0);
});

test("disabled and reduced-motion comparisons immediately become static", () => {
  for (const interaction of [idle, held(-0.2)]) {
    const state = run(createSceneMotion(), 2);
    const phase = state.phase;
    step(state, { enabled: false, interaction });
    assert.equal(state.cameraX, 0);
    assert.equal(state.velocityX, 0);
    assert.equal(state.wake, 0);
    assert.equal(state.targetX, 0);
    assert.equal(state.dragging, false);
    assert.equal(state.mode, "paused");
    run(state, 5, { enabled: false, interaction });
    assert.equal(state.cameraX, 0);
    assert.equal(state.phase, phase);
    step(state, { dt: 0 });
    assert.equal(state.cameraX, 0, "Resume does not jump");
    assert.equal(state.phase, phase);
    run(state, 1);
    assert.ok(state.cameraX > 0, "Resume continues from the frozen phase");
  }
});

test("constant-target critical spring is invariant to frame partition", () => {
  const initial = createSceneMotion();
  step(initial, { interaction: held() });
  step(initial, { dt: 0, interaction: held(-0.2) });
  const coarse = { ...initial };
  const fine = { ...initial };
  run(coarse, 0.6, { interaction: held(-0.2) }, 1 / 20);
  run(fine, 0.6, { interaction: held(-0.2) }, 1 / 120);
  close(coarse.cameraX, fine.cameraX, "Partitioned camera", 1e-12);
  close(coarse.velocityX, fine.velocityX, "Partitioned velocity", 1e-12);
});

test("changing auto and return remain consistent at 20 and 120 FPS", () => {
  const coarse = run(createSceneMotion(), 3, {}, 1 / 20);
  const fine = run(createSceneMotion(), 3, {}, 1 / 120);
  close(coarse.phase, fine.phase, "Auto phase", 1e-11);
  close(coarse.cameraX, fine.cameraX, "Auto camera", 2e-6);
  close(coarse.wake, fine.wake, "Auto wake", 1e-12);
  for (const state of [coarse, fine]) {
    step(state, { dt: 0, interaction: held() });
    step(state, { dt: 0, interaction: held(0.2) });
    step(state, { dt: 0 });
  }
  run(coarse, 2, {}, 1 / 20);
  run(fine, 2, {}, 1 / 120);
  close(coarse.returnBlend, fine.returnBlend, "Return blend", 1e-12);
  close(coarse.cameraX, fine.cameraX, "Return camera", 1e-5);
  close(coarse.wake, fine.wake, "Return wake", 1e-12);
});

test("elapsed time is capped and bounds kill outward velocity", () => {
  const large = createSceneMotion();
  const capped = createSceneMotion();
  step(large, { dt: 30 });
  step(capped, { dt: 0.05 });
  assert.deepEqual(large, capped);
  for (const [cameraX, velocityX] of [
    [defaults.rightTravel, 2],
    [-defaults.leftTravel, -2],
  ]) {
    const state = { ...createSceneMotion(), cameraX, velocityX };
    step(state, { dt: 0 });
    assert.equal(state.velocityX, 0);
    bounded(state);
  }
  const state = createSceneMotion();
  step(state, { interaction: held() });
  run(state, 1, { interaction: held(-1) });
  step(state, { leftTravel: 0, rightTravel: 0.001, interaction: held(-1) });
  bounded(state, 0, 0.001);
  assert.ok(state.dragOriginX <= 0.001);
});

test("invalid input or corrupt state cancels safely and can resume", () => {
  const invalid = [
    { dt: NaN },
    { dt: Infinity },
    { dt: -1 },
    { leftTravel: NaN },
    { rightTravel: Infinity },
    { leftTravel: -0.01 },
    { interaction: held(NaN) },
    { interaction: held(0, Infinity) },
    { interaction: undefined },
    { enabled: undefined },
  ];
  for (const input of invalid) {
    const state = run(createSceneMotion(), 1);
    const phase = state.phase;
    step(state, input);
    assert.equal(state.cameraX, 0);
    assert.equal(state.velocityX, 0);
    assert.equal(state.targetX, 0);
    assert.equal(state.wake, 0);
    assert.equal(state.dragging, false);
    assert.equal(state.mode, "paused");
    assert.equal(state.phase, phase);
    step(state);
    bounded(state);
    assert.equal(state.mode, "autonomous");
  }
  const corrupt = {
    ...createSceneMotion(),
    cameraX: NaN,
    phase: Infinity,
    gestureId: NaN,
  };
  step(corrupt);
  assert.equal(corrupt.cameraX, 0);
  assert.equal(corrupt.phase, 0);
  assert.equal(corrupt.gestureId, 0);
  assert.equal(corrupt.mode, "paused");
});

console.log(`Scene motion passed (${cases.length} behavioral cases).`);
