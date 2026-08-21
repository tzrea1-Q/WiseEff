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

  it("restores the DTS reload two-column layout without stretching a collapsed navigator", () => {
    const styles = readStylesheet("src/styles.css");
    const body = declarationsFor(
      styles,
      ".dts-reload-page .dts-reload-candidates-body.dts-parameter-workbench__body",
      { within: "workbench-main (min-width: 960px)" }
    );
    const topology = declarationsFor(
      styles,
      ".dts-reload-page .dts-reload-candidates-body .dts-workbench-topology",
      { within: "workbench-main (min-width: 960px)" }
    );
    const results = declarationsFor(
      styles,
      ".dts-reload-page .dts-reload-candidates-results",
      { within: "workbench-main (min-width: 960px)" }
    );
    const tree = declarationsFor(
      styles,
      ".dts-reload-page .dts-reload-candidates-body .dts-topology-navigator"
    );

    expect(body["grid-template-columns"]).toBe("auto minmax(0, 1fr)");
    expect(body.height).toBe("var(--dts-reload-candidates-pane-height)");
    expect(topology.width).toBe("max-content");
    expect(topology.height).toBe("auto");
    expect(topology["max-height"]).toBe("100%");
    expect(topology["align-self"]).toBe("start");
    expect(tree.flex).toBe("0 1 auto");
    expect(results.height).toBe("100%");
  });

  it("uses the shared workbench width for parameter editing and administration", () => {
    const styles = readStylesheet("src/styles.css");
    const workbench = declarationsFor(styles, ".dts-parameter-workbench");
    const body = declarationsFor(
      styles,
      ".dts-parameter-workbench > .dts-parameter-workbench__body",
      { within: "dts-workbench (min-width: 960px)" }
    );
    const topology = declarationsFor(
      styles,
      ".dts-parameter-workbench > .dts-parameter-workbench__body > .dts-workbench-topology",
      { within: "dts-workbench (min-width: 960px)" }
    );

    expect(workbench["container-type"]).toBe("inline-size");
    expect(workbench["container-name"]).toBe("dts-workbench");
    expect(body["grid-template-columns"]).toBe("auto minmax(0, 1fr)");
    expect(topology.position).toBe("sticky");
    expect(topology.width).toBe("max-content");
    expect(topology["min-width"]).toBe("var(--module-navigator-min-width)");
    expect(topology["max-width"]).toBe("var(--module-navigator-max-width)");
  });
});
