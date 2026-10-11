import { describe, expect, it } from "vitest";

import { declarationsFor, readStylesheet } from "../test/cssAssertions";

describe("LocalDeviceBridgeWizard responsive pairing layout", () => {
  it("keeps readiness compact and the guide at the right edge without hiding the workbench", () => {
    const styles = readStylesheet("src/styles.css");
    const bar = declarationsFor(styles, ".local-device-bridge-panel__readiness");
    const drawer = declarationsFor(styles, ".local-device-bridge-panel__guide-drawer");
    const backdrop = declarationsFor(styles, ".modal-backdrop.local-device-bridge-panel__guide-backdrop");
    expect(bar.display).toBe("flex");
    expect(bar["align-items"]).toBe("center");
    expect(backdrop["justify-content"]).toBe("flex-end");
    expect(backdrop.background).toBe("transparent");
    expect(drawer["max-height"]).toBe("100dvh");
    expect(drawer["overflow-y"]).toBe("auto");
    expect(drawer.width).toBe("min(var(--bridge-guide-width), 100vw)");
  });
  it("keeps readiness copy and the launch action in a flexible row", () => {
    const styles = readStylesheet("src/styles.css");
    const row = declarationsFor(styles, ".local-device-bridge-panel__readiness");
    const copy = declarationsFor(styles, ".local-device-bridge-panel__readiness-status");
    const action = declarationsFor(styles, ".local-device-bridge-panel__readiness > .button");

    expect(row.display).toBe("flex");
    expect(row["flex-wrap"]).toBe("wrap");
    expect(copy.flex).toBe("1");
    expect(copy["min-width"]).toBe("0");
    expect(action["white-space"]).toBe("normal");
  });

  it("stacks the copy and action on narrow screens", () => {
    const styles = readStylesheet("src/styles.css");
    const row = declarationsFor(styles, ".local-device-bridge-panel__readiness", {
      within: "max-width: 480px"
    });
    const copy = declarationsFor(styles, ".local-device-bridge-panel__readiness-status", {
      within: "max-width: 480px"
    });
    const action = declarationsFor(styles, ".local-device-bridge-panel__readiness > .button", {
      within: "max-width: 480px"
    });

    expect(row["flex-direction"]).toBe("column");
    expect(copy.flex).toBe("0 1 auto");
    expect(copy.width).toBe("100%");
    expect(action.width).toBe("100%");
  });
});
