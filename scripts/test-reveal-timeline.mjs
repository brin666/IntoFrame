import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function compile(relativePath) {
  const compiled = ts.transpileModule(
    readFileSync(new URL(relativePath, import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
      reportDiagnostics: true,
    },
  );
  assert.equal(
    compiled.diagnostics?.length ?? 0,
    0,
    "Timeline syntax diagnostics",
  );
  return compiled.outputText;
}
function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}
const filmSource = compile("../src/frameComposition.ts");
const filmUrl = moduleUrl(filmSource);
const timelineSource = compile("../src/remotion/revealTimeline.ts").replace(
  '"../frameComposition"',
  JSON.stringify(filmUrl),
);
const { FILM_BAR_FRACTION } = await import(filmUrl);
const {
  getRevealTimeline,
  getRevealImageRect,
  PHOTO_REVEAL_DURATION,
  PHOTO_REVEAL_FPS,
} = await import(moduleUrl(timelineSource));

const final = { zoom: 1.43, shiftX: -0.07, shiftY: 0.11 };
assert.equal(PHOTO_REVEAL_DURATION / PHOTO_REVEAL_FPS, 6);
for (const frame of [0, 1, 12, 23, 24]) {
  const state = getRevealTimeline(frame, final);
  assert.equal(
    state.zoom,
    1,
    "Original is never cropped before the pose begins",
  );
  assert.equal(state.shiftX, 0);
  assert.equal(state.shiftY, 0);
  assert.equal(state.styleProgress, 0);
  assert.equal(state.barFraction, 0);
}
assert.equal(getRevealTimeline(30, final).styleProgress, 0);
const middle = getRevealTimeline(60, final);
assert.equal(
  middle.styleProgress,
  0.5,
  "One crossfade for the entire styled group",
);
assert.equal(middle.barFraction, 0, "Bars wait for a completed restyle");
for (const frame of [90, 100, 143, 144, 179, 999]) {
  const state = getRevealTimeline(frame, final);
  assert.equal(state.zoom, final.zoom);
  assert.equal(state.shiftX, final.shiftX);
  assert.equal(state.shiftY, final.shiftY);
  assert.equal(state.styleProgress, 1);
}
for (const frame of [144, 160, 179]) {
  const state = getRevealTimeline(frame, final);
  assert.equal(state.barFraction, FILM_BAR_FRACTION);
  assert.equal(state.phase, "hold");
}
let previous = getRevealTimeline(0, final);
for (let frame = 1; frame < PHOTO_REVEAL_DURATION; frame++) {
  const state = getRevealTimeline(frame, final);
  for (const key of ["poseProgress", "styleProgress", "barProgress"]) {
    assert.ok(
      state[key] >= previous[key] && state[key] <= 1,
      `${key} is bounded and monotonic`,
    );
  }
  const pose = getRevealImageRect(1200, 800, state);
  assert.ok(Object.values(pose).every(Number.isFinite));
  assert.deepEqual(
    state,
    getRevealTimeline(frame, final),
    "Seeking gives the same frame",
  );
  previous = state;
}
assert.deepEqual(
  getRevealImageRect(1200, 800, getRevealTimeline(179, final)),
  {
    left: 1200 * ((1 - final.zoom) / 2 + final.shiftX),
    top: 800 * ((1 - final.zoom) / 2 + final.shiftY),
    width: 1200 * final.zoom,
    height: 800 * final.zoom,
  },
  "Last native rectangle exactly matches PNG export",
);
assert.deepEqual(getRevealImageRect(1200, 800, getRevealTimeline(0, final)), {
  left: 0,
  top: 0,
  width: 1200,
  height: 800,
});
console.log(
  "Reveal timeline: deterministic endpoints, grouped fade and native crop verified.",
);
