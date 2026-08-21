import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet } from "../../test/cssAssertions";

describe("DtsTopologyNavigator responsive width", () => {
  it("grows the desktop navigator to its content while keeping labels on one line", () => {
    const styles = readStylesheet("src/styles.css");
    const tokens = declarationsFor(styles, ":root");
    const body = declarationsFor(styles, ".dts-parameter-workbench__body");
    const topology = declarationsFor(styles, ".dts-workbench-topology");
    const label = declarationsFor(styles, ".dts-topology-navigator__label");

    expect(tokens["--module-navigator-min-width"]).toBeDefined();
    expect(tokens["--module-navigator-max-width"]).toBeDefined();
    expect(body["grid-template-columns"]).toBe("auto minmax(0, 1fr)");
    expect(topology.width).toBe("max-content");
    expect(topology["min-width"]).toBe("var(--module-navigator-min-width)");
    expect(topology["max-width"]).toBe("var(--module-navigator-max-width)");
    expect(label["white-space"]).toBe("nowrap");
    expect(label["overflow-wrap"]).toBe("normal");
  });

  it("uses the full available width below the two-column breakpoint", () => {
    const styles = readStylesheet("src/styles.css");
    const topology = declarationsFor(styles, ".dts-workbench-topology", {
      within: "max-width: 1200px"
    });

    expect(topology.width).toBe("100%");
    expect(topology["min-width"]).toBe("0");
    expect(topology["max-width"]).toBe("none");
  });
});
