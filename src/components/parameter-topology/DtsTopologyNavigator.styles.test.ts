import { describe, expect, it } from "vitest";
import { declarationsFor, hasRule, readStylesheet } from "../../test/cssAssertions";

describe("DtsTopologyNavigator responsive width", () => {
  it("leaves JSON workbench shell spacing and pane geometry to the shared template", () => {
    const styles = readStylesheet("src/styles.css");

    for (const selector of [
      ".json-parameter-workbench",
      ".json-parameter-workbench__list",
      ".json-parameter-workbench__list .dts-workbench-list__scroll-x",
      ".json-parameter-workbench__list .dts-workbench-list__scroll-y"
    ]) {
      expect(hasRule(styles, selector), selector).toBe(false);
    }
  });

  it("does not retain the replaced inline inspector or page-state boxes", () => {
    const styles = readStylesheet("src/styles.css");

    for (const selector of [
      ".json-parameter-workbench__inspector",
      ".json-parameter-workbench__no-selection",
      ".json-parameter-workbench__no-selection-icon",
      ".dts-parameter-workbench--status",
      '.dts-parameter-workbench--status[aria-busy="true"]',
      '.dts-parameter-workbench--status[aria-busy="true"] [role="status"]',
      ".dts-parameter-workbench--status .project-topology-workspace__empty",
      ".dts-parameter-workbench--status .project-topology-workspace__error",
      ".dts-parameter-workbench--status .project-topology-workspace__error .button"
    ]) {
      expect(hasRule(styles, selector), selector).toBe(false);
    }
  });

  it("uses shared elevation for parameter workbench row hover", () => {
    const styles = readStylesheet("src/components/layout/navigator-workbench.css");
    expect(declarationsFor(styles, ".navigator-workbench .dts-parameter-workbench-table__row:hover")["box-shadow"])
      .toBe("var(--shadow-1)");
  });

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

  it("leaves DTS reload pane geometry to the shared navigator workbench", () => {
    const styles = readStylesheet("src/styles.css");
    const sharedStyles = readStylesheet("src/components/layout/navigator-workbench.css");
    const body = declarationsFor(sharedStyles, ".navigator-workbench__body");
    const navigator = declarationsFor(sharedStyles, ".navigator-workbench__navigator");
    const task = declarationsFor(sharedStyles, ".navigator-workbench__task");

    for (const selector of [
      ".dts-reload-page .dts-reload-candidates-body.dts-parameter-workbench__body",
      ".dts-reload-page .dts-reload-candidates-body .dts-workbench-topology",
      ".dts-reload-page .dts-reload-candidates-results",
      ".dts-reload-page .dts-reload-candidates-body .dts-topology-navigator"
    ]) {
      expect(hasRule(styles, selector), selector).toBe(false);
    }
    expect(body["grid-template-columns"])
      .toBe("min(var(--navigator-workbench-navigator-width), var(--navigator-workbench-navigator-cap)) minmax(0, 1fr)");
    expect(body["align-items"]).toBe("start");
    expect(navigator.height).toBeUndefined();
    expect(navigator["max-height"]).toBe("var(--navigator-workbench-pane-height)");
    expect(task["max-height"]).toBe("var(--navigator-workbench-pane-height)");
    expect(task.overflow).toBe("auto");
  });

  it("fits parameter counts in the bounded navigator and ellipsizes only long labels", () => {
    const styles = readStylesheet("src/components/layout/navigator-workbench.css");
    const tokens = declarationsFor(readStylesheet("src/styles.css"), ":root");
    expect(tokens["--navigator-workbench-navigator-width"]).toBe("18rem");
    expect(tokens["--navigator-workbench-navigator-cap"]).toBe("var(--module-navigator-max-width)");
    expect(declarationsFor(styles, ".navigator-workbench__body")["grid-template-columns"])
      .toBe("min(var(--navigator-workbench-navigator-width), var(--navigator-workbench-navigator-cap)) minmax(0, 1fr)");
    expect(declarationsFor(styles, ".navigator-workbench__navigation").overflow).toBe("auto");
    expect(declarationsFor(styles, ".navigator-workbench__navigation .dts-topology-navigator").width).toBe("100%");
    expect(declarationsFor(styles, ".navigator-workbench .dts-topology-navigator__item")["grid-template-columns"])
      .toBe("var(--module-navigator-disclosure-size) minmax(0, 1fr) max-content");
    const label = declarationsFor(styles, ".navigator-workbench .dts-topology-navigator__label");
    expect(label["white-space"]).toBe("nowrap");
    expect(label.overflow).toBe("hidden");
    expect(label["text-overflow"]).toBe("ellipsis");
    const metadata = declarationsFor(styles, ".navigator-workbench .dts-topology-navigator__meta");
    expect(metadata["min-width"]).toBe("max-content");
    expect(metadata["max-width"]).toBe("none");
    expect(declarationsFor(styles, ".navigator-workbench .dts-topology-navigator__count").overflow).toBe("visible");
  });

  it("does not stretch collapsed roots inside the shared navigation slot", () => {
    const styles = readStylesheet("src/styles.css");
    const sharedStyles = readStylesheet("src/components/layout/navigator-workbench.css");
    const navigation = declarationsFor(sharedStyles, ".navigator-workbench__navigation");
    const tree = declarationsFor(sharedStyles, ".navigator-workbench__navigation .dts-topology-navigator");

    expect(hasRule(styles, ".node-debugging-module-workbench .dts-topology-navigator")).toBe(false);
    expect(navigation.display).not.toBe("flex");
    expect(navigation.height).toBeUndefined();
    expect(tree.flex).toBeUndefined();
    expect(tree["max-height"]).toBe("none");
  });
});
