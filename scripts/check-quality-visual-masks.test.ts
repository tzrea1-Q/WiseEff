import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("quality visual masks", () => {
  it("keeps Xiaoze content observable and settles the popup closed on stable routes", () => {
    const helpers = readFileSync("e2e/quality/helpers.ts", "utf8");
    const visualSpec = readFileSync("e2e/quality/visual.quality.spec.ts", "utf8");

    expect(helpers).not.toContain('page.locator(".xiaoze-popup-window")');
    expect(helpers).not.toContain('page.locator(".xiaoze-toggle-hint")');
    expect(visualSpec).toContain("settleXiaozePopupClosed(page)");
    expect(visualSpec).toContain("dismissXiaozeToggleHintIfPresent(page)");
    expect(visualSpec).toContain('toHaveScreenshot("xiaoze-popup-open.png");');

    for (const platform of ["darwin", "linux"]) {
      const popupBaseline = decodeRgbPng(
        readFileSync(`e2e/quality/visual.quality.spec.ts-snapshots/${platform}/xiaoze-popup-open.png`)
      );
      const magentaPixels = countMagentaPixelsInDecodedPng(popupBaseline);
      expect(magentaPixels).toBeLessThan(popupBaseline.width * popupBaseline.height * 0.01);
    }
  });

  it("keeps the populated parameter review detail observable", () => {
    const helpers = readFileSync("e2e/quality/helpers.ts", "utf8");

    expect(helpers).not.toContain('page.locator(".review-detail")');
    for (const platform of ["darwin", "linux"]) {
      const baseline = decodeRgbPng(
        readFileSync(`e2e/quality/visual.quality.spec.ts-snapshots/${platform}/parameter-review-workbench.png`)
      );
      expect(countMagentaPixelsInDecodedPng(baseline)).toBeLessThan(
        baseline.width * baseline.height * 0.05
      );
    }
  });

  it("keeps organization baselines free of giant mask regions", () => {
    for (const platform of ["darwin", "linux"]) {
      for (const name of ["organization.png", "organization-members.png"]) {
        const baseline = decodeRgbPng(
          readFileSync(`e2e/quality/visual.quality.spec.ts-snapshots/${platform}/${name}`)
        );
        expect(countMagentaPixelsInDecodedPng(baseline)).toBe(0);
      }
    }
  });

  it("requires the authenticated application shell before visual assertions", () => {
    const helpers = readFileSync("e2e/quality/helpers.ts", "utf8");

    expect(helpers).toContain('page.locator(".app-shell")');
    expect(helpers).toContain('page.locator(".auth-screen")');
    expect(helpers).toMatch(/\.auth-screen[\s\S]*toHaveCount\(0/);
  });

  it("masks dynamic parameter table rows only for the parameters workbench screenshot", () => {
    const helpers = readFileSync("e2e/quality/helpers.ts", "utf8");
    const visualSpec = readFileSync("e2e/quality/visual.quality.spec.ts", "utf8");

    expect(helpers).toContain(".dts-parameter-workbench-table, .dts-workbench-list");
    expect(helpers).toMatch(/routePath\s*===\s*"\/parameters"/);
    expect(visualSpec).toContain("stableMasks(page, route.path)");
  });

  it("renders a deterministic home-org created-at value without masking its pixels", () => {
    const helpers = readFileSync("e2e/quality/helpers.ts", "utf8");
    const visualSpec = readFileSync("e2e/quality/visual.quality.spec.ts", "utf8");

    expect(helpers).not.toContain('page.locator(".organization-profile__created-at")');
    expect(helpers).toContain("stabilizeOrganizationVisualClock");
    expect(visualSpec).toContain("stabilizeOrganizationVisualClock(page)");
  });

  it("masks /logs timestamps and waits for seeded hydrate before the screenshot", () => {
    const helpers = readFileSync("e2e/quality/helpers.ts", "utf8");

    expect(helpers).toMatch(/routePath\s*===\s*"\/logs"/);
    expect(helpers).toContain(".rawlog-table__time");
    expect(helpers).toContain("charging-foldback.log");
    expect(helpers).toContain("unsupported.bin");
    expect(helpers).toContain("日志处理失败");
    expect(helpers.indexOf('routePath === "/logs"')).toBeLessThan(helpers.indexOf("charging-foldback.log"));
    // Empty-state alert reuses the same title, so settle must pin the selected
    // seed row and wait for fonts + a paint before the screenshot.
    expect(helpers).toContain(".history-item.active");
    expect(helpers).toContain(".log-error-alert");
    expect(helpers).toContain("document.fonts.ready");
    expect(helpers).toContain("requestAnimationFrame");
    expect(helpers).toContain(".confidence-bar i");
  });

  it("settles the full-page add-user dialog shot after the API sync banner drains", () => {
    const helpers = readFileSync("e2e/quality/helpers.ts", "utf8");
    const visualSpec = readFileSync("e2e/quality/visual.quality.spec.ts", "utf8");

    expect(helpers).toContain("export async function waitForFontsAndNextPaint");
    expect(visualSpec).toContain("state-dialog-modal-open.png");
    expect(visualSpec).toContain(".api-runtime-sync-banner");
    expect(visualSpec).toContain("waitForFontsAndNextPaint");
  });

  it("keeps platform parameter baselines aligned with the masked dynamic table", () => {
    for (const platform of ["linux", "win32"]) {
      const maskPixels = countMagentaPixels(
        `e2e/quality/visual.quality.spec.ts-snapshots/${platform}/parameters-workbench.png`
      );

      expect(maskPixels).toBeGreaterThan(400_000);
    }
  });
});

function countMagentaPixels(path: string) {
  const png = Buffer.from(readFileSync(path, "binary"), "binary");
  return countMagentaPixelsInDecodedPng(decodeRgbPng(png));
}

function countMagentaPixelsInDecodedPng({ width, height, data }: ReturnType<typeof decodeRgbPng>) {
  let count = 0;

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 3;
    if (data[offset] === 255 && data[offset + 1] === 0 && data[offset + 2] === 255) {
      count += 1;
    }
  }

  return count;
}

function decodeRgbPng(png: Buffer) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const bitDepth = png[24];
  const colorType = png[25];
  const chunks: Buffer[] = [];
  let cursor = 33;

  if (bitDepth !== 8 || colorType !== 2) {
    throw new Error(`Unsupported PNG format for visual mask check: bitDepth=${bitDepth}; colorType=${colorType}`);
  }

  while (cursor < png.length) {
    const length = png.readUInt32BE(cursor);
    const type = png.subarray(cursor + 4, cursor + 8).toString("ascii");
    const dataStart = cursor + 8;

    if (type === "IDAT") {
      chunks.push(png.subarray(dataStart, dataStart + length));
    }

    cursor = dataStart + length + 4;
  }

  const inflated = inflateSync(Buffer.concat(chunks));
  const stride = width * 3;
  const bytesPerPixel = 3;
  const data = Buffer.alloc(width * height * 3);
  let sourceOffset = 0;

  for (let row = 0; row < height; row += 1) {
    const filter = inflated[sourceOffset];
    const rowStart = row * stride;
    const rawRow = inflated.subarray(sourceOffset + 1, sourceOffset + 1 + stride);

    decodeScanline(filter, rawRow, data, rowStart, stride, bytesPerPixel);
    sourceOffset += stride + 1;
  }

  return { width, height, data };
}

function decodeScanline(filter: number, rawRow: Buffer, output: Buffer, rowStart: number, stride: number, bytesPerPixel: number) {
  const previousRowStart = rowStart - stride;

  for (let column = 0; column < stride; column += 1) {
    const left = column >= bytesPerPixel ? output[rowStart + column - bytesPerPixel] : 0;
    const up = previousRowStart >= 0 ? output[previousRowStart + column] : 0;
    const upLeft = previousRowStart >= 0 && column >= bytesPerPixel ? output[previousRowStart + column - bytesPerPixel] : 0;
    const raw = rawRow[column];
    let value: number;

    switch (filter) {
      case 0:
        value = raw;
        break;
      case 1:
        value = raw + left;
        break;
      case 2:
        value = raw + up;
        break;
      case 3:
        value = raw + Math.floor((left + up) / 2);
        break;
      case 4:
        value = raw + paethPredictor(left, up, upLeft);
        break;
      default:
        throw new Error(`Unsupported PNG filter ${filter}; visual mask check supports PNG filters 0-4.`);
    }

    output[rowStart + column] = value & 0xff;
  }
}

function paethPredictor(left: number, up: number, upLeft: number) {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);

  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  if (distanceUp <= distanceUpLeft) return up;
  return upLeft;
}
