import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const cssText = readFileSync("src/linear-template/linear-template.css", "utf8");

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCssRule(selector: string) {
  const match = cssText.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, "s"));
  if (!match) {
    throw new Error(`Missing CSS rule for ${selector}`);
  }
  return match[1];
}

function getKeyframes(name: string) {
  const start = cssText.indexOf(`@keyframes ${name}`);
  if (start === -1) {
    throw new Error(`Missing keyframes for ${name}`);
  }

  const openingBrace = cssText.indexOf("{", start);
  let depth = 0;

  for (let index = openingBrace; index < cssText.length; index += 1) {
    const character = cssText[index];
    if (character === "{") {
      depth += 1;
    }
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return cssText.slice(openingBrace + 1, index);
      }
    }
  }

  throw new Error(`Unclosed keyframes for ${name}`);
}

describe("WiseEff hero stage animation", () => {
  it("uses slower, more obvious side-to-side carousel motion", () => {
    expect(getCssRule(".wiseeff-stage-frame.slide-next")).toMatch(
      /animation:\s*wiseeffStageSlideNext\s+1120ms\s+cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)\s+both/
    );
    expect(getCssRule(".wiseeff-stage-frame.slide-prev")).toMatch(
      /animation:\s*wiseeffStageSlidePrev\s+1120ms\s+cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)\s+both/
    );

    expect(getKeyframes("wiseeffStageSlideNext")).toContain("translate3d(22%, 0, 0)");
    expect(getKeyframes("wiseeffStageSlideNext")).toContain("translate3d(-2%, 0, 0)");
    expect(getKeyframes("wiseeffStageSlidePrev")).toContain("translate3d(-22%, 0, 0)");
    expect(getKeyframes("wiseeffStageSlidePrev")).toContain("translate3d(2%, 0, 0)");
  });

  it("staggers inner panels enough to reinforce the carousel direction", () => {
    expect(getCssRule(".wiseeff-stage-frame.slide-next .wiseeff-stage-main")).toMatch(
      /wiseeffStagePanelSettleNext\s+1080ms\s+120ms/
    );
    expect(getCssRule(".wiseeff-stage-frame.slide-prev .wiseeff-stage-main")).toMatch(
      /wiseeffStagePanelSettlePrev\s+1080ms\s+120ms/
    );
    expect(getKeyframes("wiseeffStagePanelSettleNext")).toContain("translate3d(34px, 0, 0)");
    expect(getKeyframes("wiseeffStagePanelSettlePrev")).toContain("translate3d(-34px, 0, 0)");
  });
});
