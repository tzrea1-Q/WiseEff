import { describe, expect, it } from "vitest";

import { allSelectors, hasAtRule, readStylesheet } from "../test/cssAssertions";

const cssText = readStylesheet("src/linear-template/linear-template.css");

describe("retired homepage stage styles", () => {
  it("removes old carousel, Agent section, and product section CSS", () => {
    const retiredSelectorFragments = [
      "wiseeff-hero-stage",
      "wiseeff-stage-",
      "wiseeff-boundary-panel",
      "wiseeff-evidence-grid",
      "wiseeff-preview",
      "linear-stars",
      "linear-sketch-lines",
      "linear-flow-lines",
      "linear-unlike",
      "linear-tool-grid",
      "linear-tool-card",
      "logo-light-card",
      "command-card",
      "linear-logo-light-mock",
      "linear-command-menu-mock",
      "linear-command-input",
      "linear-product-section",
      "linear-feature-main",
      "linear-feature-image-frame",
      "linear-feature-summary",
      "linear-feature-grid",
      "linear-feature-card"
    ];

    expect(
      allSelectors(cssText).filter((selector) =>
        retiredSelectorFragments.some((fragment) => selector.includes(fragment))
      )
    ).toEqual([]);
  });

  it("removes keyframes that only powered the retired hero stage", () => {
    [
      "linearImageRotate",
      "linearImageIn",
      "wiseeffStageShellIn",
      "wiseeffStageSlideNext",
      "wiseeffStageSlidePrev",
      "wiseeffStagePanelSettleNext",
      "wiseeffStagePanelSettlePrev",
      "linearSketchLines",
      "linearGlowHorizontal",
      "linearGlowVertical"
    ].forEach((keyframeName) => {
      expect(hasAtRule(cssText, `@keyframes ${keyframeName}`)).toBe(false);
    });
  });
});
