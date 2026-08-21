import { describe, expect, it } from "vitest";

import { declarationsFor, readStylesheet } from "../test/cssAssertions";

describe("LocalDeviceBridgeWizard responsive pairing layout", () => {
  it("keeps pairing copy and the launch action in a flexible row", () => {
    const styles = readStylesheet("src/styles.css");
    const row = declarationsFor(styles, ".local-device-bridge-panel__already-installed");
    const copy = declarationsFor(styles, ".local-device-bridge-panel__already-installed > .local-device-bridge-panel__install-desc");
    const action = declarationsFor(styles, ".local-device-bridge-panel__already-installed-cta");

    expect(row.display).toBe("flex");
    expect(row["flex-wrap"]).toBe("wrap");
    expect(row.margin).toBe("0");
    expect(copy.flex).toBe("1 1 18rem");
    expect(copy["min-width"]).toBe("0");
    expect(action["white-space"]).toBe("normal");
  });

  it("stacks the copy and action on narrow screens", () => {
    const styles = readStylesheet("src/styles.css");
    const row = declarationsFor(styles, ".local-device-bridge-panel__already-installed", {
      within: "max-width: 480px"
    });
    const copy = declarationsFor(styles, ".local-device-bridge-panel__already-installed > .local-device-bridge-panel__install-desc", {
      within: "max-width: 480px"
    });
    const action = declarationsFor(styles, ".local-device-bridge-panel__already-installed-cta", {
      within: "max-width: 480px"
    });

    expect(row["flex-direction"]).toBe("column");
    expect(copy.flex).toBe("0 1 auto");
    expect(copy.width).toBe("100%");
    expect(action.width).toBe("100%");
  });
});
