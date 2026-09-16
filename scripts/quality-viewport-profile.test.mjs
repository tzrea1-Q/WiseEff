import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { qualityViewports } from "./quality-viewport-profile.ts";

test("default coverage is exactly one PC viewport", () => {
  assert.deepEqual(qualityViewports(undefined), [{ name: "desktop", width: 1440, height: 900 }]);
});
test("explicit desktop equals the default", () => {
  assert.deepEqual(qualityViewports("desktop"), qualityViewports(undefined));
});
test("compact is one PC window rather than another full matrix", () => {
  assert.deepEqual(qualityViewports("compact"), [{ name: "compact", width: 1280, height: 800 }]);
});
test("extended retains all original compatibility dimensions", () => {
  assert.deepEqual(qualityViewports("extended"), [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 834, height: 1112 },
    { name: "mobile", width: 390, height: 844 }
  ]);
});
for (const profile of ["", "mobile", "all", "Desktop", " desktop ", "desktop\n", "private-value"]) {
  test(`invalid profile ${JSON.stringify(profile)} fails closed`, () => {
    assert.throws(() => qualityViewports(profile), {
      message: "WISEEFF_QUALITY_VIEWPORT_PROFILE must be desktop, compact, or extended."
    });
  });
}
test("callers cannot change subsequent coverage by mutating a returned list", () => {
  const first = qualityViewports("extended");
  first.pop();
  first[0].width = 1;
  assert.equal(qualityViewports("extended").length, 3);
  assert.equal(qualityViewports(undefined)[0].width, 1440);
});
test("responsive suite consumes the selector and uses the selected dialog viewport", () => {
  const spec = readFileSync(new URL("../e2e/quality/responsive.quality.spec.ts", import.meta.url), "utf8");
  assert.match(spec, /qualityViewports\(process\.env\.WISEEFF_QUALITY_VIEWPORT_PROFILE\)/);
  assert.match(spec, /const dialogViewport = viewports\.find\(.*?mobile.*?\) \?\? viewports\[0\]/);
  assert.match(spec, /width: dialogViewport\.width, height: dialogViewport\.height/);
  assert.doesNotMatch(spec, /setViewportSize\(\{ width: 390, height: 844 \}\)/);
});
