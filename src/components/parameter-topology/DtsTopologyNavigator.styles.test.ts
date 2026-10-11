import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet } from "../../test/cssAssertions";

describe("DtsTopologyNavigator responsive width", () => {
  it("keeps the disclosure column fixed instead of distributing spare space before labels", () => {
    const styles = readStylesheet("src/styles.css");
    const tokens = declarationsFor(styles, ":root");
    const row = declarationsFor(styles, ".dts-topology-navigator__item");

    expect(tokens["--module-navigator-disclosure-size"]).toBe("28px");
    expect(row["grid-template-columns"].startsWith("var(--module-navigator-disclosure-size) max-content ")).toBe(true);
  });

  it("retains the metadata track's intrinsic width so long labels scroll instead of hiding counts", () => {
    const styles = readStylesheet("src/styles.css");
    const row = declarationsFor(styles, ".dts-topology-navigator__item");

    expect(row["grid-template-columns"]).toBe("var(--module-navigator-disclosure-size) max-content auto");
  });

  it("reserves the existing touch disclosure width in the label anchor instead of overlapping the label", () => {
    const styles = readStylesheet("src/styles.css");
    const tokens = declarationsFor(styles, ":root");
    const touchTokens = declarationsFor(styles, ":root", { within: "max-width: 480px" });

    expect(touchTokens["--module-navigator-disclosure-size"]).toBe("calc(var(--space-10) + var(--space-1))");
    expect(tokens["--space-10"]).toBe("40px");
    expect(tokens["--space-1"]).toBe("4px");
  });

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

  it("uses a tokenized bounded navigator and internal label scrolling for parameter editing", () => {
    const styles = readStylesheet("src/components/layout/navigator-workbench.css");
    const tokens = declarationsFor(readStylesheet("src/styles.css"), ":root");
    expect(tokens["--navigator-workbench-navigator-width"]).toBe("var(--module-navigator-min-width)");
    expect(tokens["--navigator-workbench-navigator-cap"]).toBe("var(--module-navigator-max-width)");
    expect(declarationsFor(styles, ".navigator-workbench__body")["grid-template-columns"])
      .toBe("min(var(--navigator-workbench-navigator-width), var(--navigator-workbench-navigator-cap)) minmax(0, 1fr)");
    expect(declarationsFor(styles, ".navigator-workbench__navigation").overflow).toBe("auto");
    expect(declarationsFor(styles, ".navigator-workbench__navigation .dts-topology-navigator").width).toBe("max-content");
  });

  it("does not stretch collapsed roots on the node debugging page", () => {
    const styles = readStylesheet("src/styles.css");
    const tree = declarationsFor(styles, ".node-debugging-module-workbench .dts-topology-navigator");

    expect(tree.flex).toBe("0 1 auto");
  });
});
