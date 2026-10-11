import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Transpile the actual pure helper without creating emitted files in the repo.
const source = readFileSync(
  new URL("../src/parallax.ts", import.meta.url),
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
  "Parallax helper has syntax diagnostics",
);
const { calculateParallax, subjectZ, CAMERA_DISTANCE, FOV, SKY_Z } =
  await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`
  );

const base = {
  width: 1000,
  height: 600,
  zoom: 1,
  shiftX: 0,
  sourceWidth: 1200,
  paddingX: 72,
  subjectBounds: [220, 80, 980, 1200],
  subjectStats: { occupancy: 0.3, leftEdgeFraction: 0, rightEdgeFraction: 0 },
  foregroundDepth: 0.65,
  touch: false,
  travelScale: 1,
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
function screenShift(options, travel) {
  const focal = options.height / (2 * Math.tan((FOV * Math.PI) / 360));
  return (
    (options.zoom * focal * travel) /
    (CAMERA_DISTANCE - subjectZ(options.foregroundDepth))
  );
}
function separation(options, travel) {
  const focal = options.height / (2 * Math.tan((FOV * Math.PI) / 360));
  return (
    options.zoom *
    focal *
    travel *
    (1 / (CAMERA_DISTANCE - subjectZ(options.foregroundDepth)) -
      1 / (CAMERA_DISTANCE - (options.backgroundZ ?? SKY_Z)))
  );
}

test("subject depth remains bounded", () => {
  close(subjectZ(-1), 0.78, "Far subject bound");
  close(subjectZ(2), 0.98, "Near subject bound");
  close(subjectZ(0.65), 0.883, "Model depth mapping");
});

test("desktop motion reaches its visible separation target", () => {
  for (const size of [
    { width: 1000, height: 600 },
    { width: 400, height: 400 },
  ]) {
    const options = { ...base, ...size };
    const result = calculateParallax(options);
    assert.ok(result.targetGap >= 4 && result.targetGap <= 6);
    close(
      separation(options, result.leftTravel),
      result.targetGap,
      "Desktop left gap",
    );
    close(
      separation(options, result.rightTravel),
      result.targetGap,
      "Desktop right gap",
    );
    assert.equal(result.notice, undefined);
  }
});

test("touch motion uses a smaller pixel target", () => {
  for (const width of [300, 360]) {
    const options = { ...base, width, height: 480, touch: true };
    const result = calculateParallax(options);
    assert.ok(result.targetGap >= 2.8 && result.targetGap <= 4);
    close(
      separation(options, result.leftTravel),
      result.targetGap,
      "Touch left gap",
    );
    close(
      separation(options, result.rightTravel),
      result.targetGap,
      "Touch right gap",
    );
  }
});

test("occupancy changes the target modestly within the device range", () => {
  const options = { ...base, width: 400, height: 400 };
  const small = calculateParallax({
    ...options,
    subjectStats: { ...base.subjectStats, occupancy: 0.02 },
  });
  const large = calculateParallax({
    ...options,
    subjectStats: { ...base.subjectStats, occupancy: 0.9 },
  });
  assert.ok(small.targetGap > large.targetGap);
  assert.ok(small.targetGap / large.targetGap < 1.12);
  assert.ok(large.targetGap >= 4 && small.targetGap <= 6);
});

test("a right source cut forbids positive camera travel at the uncropped edge", () => {
  const options = {
    ...base,
    subjectBounds: [220, 80, 1200, 1200],
    subjectStats: { ...base.subjectStats, rightEdgeFraction: 0.08 },
  };
  const result = calculateParallax(options);
  assert.equal(result.rightTravel, 0);
  assert.ok(result.leftTravel > 0, "The safe direction remains available");
  assert.match(result.notice, /one side/);
});

test("a left source cut forbids negative camera travel at the uncropped edge", () => {
  const result = calculateParallax({
    ...base,
    subjectBounds: [0, 80, 980, 1200],
    subjectStats: { ...base.subjectStats, leftEdgeFraction: 0.08 },
  });
  assert.equal(result.leftTravel, 0);
  assert.ok(result.rightTravel > 0);
  assert.match(result.notice, /one side/);
});

test("cuts on both sides make an unzoomed composition static", () => {
  const result = calculateParallax({
    ...base,
    subjectBounds: [0, 80, 1200, 1200],
    subjectStats: {
      occupancy: 0.8,
      leftEdgeFraction: 0.08,
      rightEdgeFraction: 0.08,
    },
  });
  assert.equal(result.leftTravel, 0);
  assert.equal(result.rightTravel, 0);
  assert.ok(result.notice);
});

test("zoom and horizontal composition limit motion to the actual overhang", () => {
  const options = {
    ...base,
    zoom: 1.02,
    shiftX: -0.009,
    subjectBounds: [220, 80, 1200, 1200],
    subjectStats: { ...base.subjectStats, rightEdgeFraction: 0.08 },
  };
  const rightOverhang =
    options.width * (0.5 + options.shiftX + options.zoom / 2) - options.width;
  const result = calculateParallax(options);
  assert.ok(result.rightTravel > 0);
  close(
    screenShift(options, result.rightTravel),
    rightOverhang,
    "Right cut stays beyond viewport",
  );
  assert.ok(separation(options, result.rightTravel) < result.targetGap);

  const leftOptions = {
    ...options,
    shiftX: 0.009,
    subjectBounds: [0, 80, 980, 1200],
    subjectStats: { ...base.subjectStats, leftEdgeFraction: 0.08 },
  };
  const leftOverhang =
    -leftOptions.width * (0.5 + leftOptions.shiftX - leftOptions.zoom / 2);
  const leftResult = calculateParallax(leftOptions);
  close(
    screenShift(leftOptions, leftResult.leftTravel),
    leftOverhang,
    "Left cut stays beyond viewport",
  );
});

test("a complete source subject keeps motion when zoom crops its silhouette", () => {
  const options = {
    ...base,
    zoom: 2,
    subjectBounds: [2, 80, 1198, 1200],
  };
  const result = calculateParallax(options);
  assert.ok(result.leftTravel > 0 && result.rightTravel > 0);
  close(
    separation(options, result.leftTravel),
    result.targetGap,
    "Intact subject left gap",
  );
  close(
    separation(options, result.rightTravel),
    result.targetGap,
    "Intact subject right gap",
  );
  assert.equal(result.notice, undefined);
});

test("padding caps each direction at 60 percent of near-plane overscan", () => {
  const options = { ...base, paddingX: { left: 1, right: 2 } };
  const result = calculateParallax(options);
  close(
    screenShift(options, result.leftTravel),
    (options.width / options.sourceWidth) * 0.6,
    "Left padding reserve",
  );
  close(
    screenShift(options, result.rightTravel),
    ((options.width * 2) / options.sourceWidth) * 0.6,
    "Right padding reserve",
  );
  assert.ok(
    separation(options, Math.max(result.leftTravel, result.rightTravel)) < 2,
  );
  assert.match(result.notice, /subtle/);
});

test("a source crop below two pixels of realized separation reports subtle motion", () => {
  const options = {
    ...base,
    zoom: 1.001,
    subjectBounds: [0, 80, 1200, 1200],
    subjectStats: {
      occupancy: 0.8,
      leftEdgeFraction: 0.08,
      rightEdgeFraction: 0.08,
    },
  };
  const result = calculateParallax(options);
  assert.ok(result.leftTravel > 0 && result.rightTravel > 0);
  assert.ok(
    separation(options, Math.max(result.leftTravel, result.rightTravel)) < 2,
  );
  assert.match(result.notice, /subtle/);
});

test("zoom preserves the pixel target without raising the world travel ceiling", () => {
  const zoomed = { ...base, zoom: 1.1 };
  const before = calculateParallax(base);
  const after = calculateParallax(zoomed);
  close(
    separation(zoomed, after.leftTravel),
    after.targetGap,
    "Zoomed pixel gap",
  );
  assert.ok(after.leftTravel < before.leftTravel);
  const tiny = calculateParallax({
    ...base,
    width: 40,
    height: 20,
    paddingX: 100000,
  });
  close(tiny.leftTravel, 0.12, "Global travel ceiling");
  close(tiny.rightTravel, 0.12, "Global travel ceiling");
});

test("photo background and explicit travel scale use the same projection", () => {
  const photoOptions = { ...base, backgroundZ: 0 };
  const photo = calculateParallax(photoOptions);
  close(
    separation(photoOptions, photo.leftTravel),
    photo.targetGap,
    "Photo depth gap",
  );
  const reducedOptions = { ...base, travelScale: 0.5 };
  const reduced = calculateParallax(reducedOptions);
  close(
    reduced.targetGap,
    calculateParallax(base).targetGap * 0.5,
    "Requested reduced gap",
  );
  close(
    separation(reducedOptions, reduced.leftTravel),
    reduced.targetGap,
    "Reduced separation",
  );
});

test("bottom contact does not suppress horizontal motion", () => {
  const result = calculateParallax({
    ...base,
    subjectBounds: [220, 0, 980, 100000],
  });
  close(
    result.leftTravel,
    calculateParallax(base).leftTravel,
    "Bottom contact left motion",
  );
  close(
    result.rightTravel,
    calculateParallax(base).rightTravel,
    "Bottom contact right motion",
  );
});

test("legacy bounds and missing viewport data degrade safely", () => {
  const legacy = calculateParallax({
    ...base,
    subjectStats: undefined,
    subjectBounds: [0, 80, 1200, 1200],
  });
  assert.equal(legacy.leftTravel, 0);
  assert.equal(legacy.rightTravel, 0);
  assert.ok(legacy.notice);
  const invalid = calculateParallax({ ...base, width: 0 });
  assert.equal(invalid.leftTravel, 0);
  assert.equal(invalid.rightTravel, 0);
  assert.ok(invalid.notice);
});

test("a narrow source cut still constrains its unsafe direction", () => {
  const result = calculateParallax({ ...base,
    subjectStats: { occupancy: .25, leftEdgeFraction: 0, rightEdgeFraction: .005 } });
  assert.equal(result.rightTravel, 0);
  assert(result.leftTravel > 0);
});

console.log(`Parallax calculations passed (${cases.length} cases).`);
