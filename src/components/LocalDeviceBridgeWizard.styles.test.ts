import { describe, expect, it } from "vitest";

import { declarationsFor, readStylesheet } from "../test/cssAssertions";

describe("LocalDeviceBridgeWizard responsive pairing layout", () => {
  it("keeps readiness compact and the guide at the right edge without hiding the workbench", () => {
    const styles = readStylesheet("src/styles.css");
    const drawer = declarationsFor(styles, ".local-device-bridge-panel__guide-drawer");
    expect(drawer.width).toBe("min(var(--bridge-guide-width), 100vw)");
  });
});
