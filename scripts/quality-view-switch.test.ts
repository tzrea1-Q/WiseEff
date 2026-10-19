import { describe, expect, it } from "vitest";

import { requireViewSwitchStyles } from "../e2e/quality/view-switch";
import { consistencyRoutes, viewSwitchStyleExpectations } from "../e2e/quality/consistency-routes";
import { requireCompactControlHeights } from "../e2e/quality/consistency-assertions";

const signatures = [
  { variant: "section", role: "button", groupRole: "navigation", height: 40, radius: "999px 999px 999px 999px", fontSize: "14px", lineHeight: "22px", fontWeight: "600", background: "rgb(255, 255, 255)", selectedBackground: "rgb(0, 61, 155)" },
  { variant: "tabs", role: "tab", groupRole: "tablist", height: 32, radius: "8px 8px 8px 8px", fontSize: "13px", lineHeight: "20px", fontWeight: "600", background: "rgb(255, 255, 255)", selectedBackground: "rgb(218, 226, 255)" },
  { variant: "toggle", role: "radio", groupRole: "radiogroup", height: 28, radius: "6px 6px 6px 6px", fontSize: "12px", lineHeight: "18px", fontWeight: "600", background: "rgb(247, 249, 252)", selectedBackground: "rgb(255, 255, 255)" }
];

function measurement(style = signatures[0], selected = true) {
  return { ...style, dom: "button.organization-switch", group: "nav.organization", selected,
    background: selected ? style.selectedBackground : style.background };
}

describe("view-switch consistency", () => {
  it("enforces styles on every live switch route, including explicit project conflicts and the retired account redirect", () => {
    const auditPaths = [
      "/debugging-admin", "/debugging-admin/nodes", "/knowledge-admin",
      "/log-admin", "/log-admin?tab=quality", "/log-admin?tab=skills", "/logs",
      "/organization", "/organization/members", "/parameter-admin", "/parameter-admin/identity-mapping",
      "/parameter-admin/modules", "/parameter-admin/modules/queue", "/parameter-admin/modules/registry",
      "/parameter-admin/projects", "/parameter-admin/projects/aurora/configuration?tab=conflicts",
      "/parameter-admin/projects/aurora/review-roles", "/parameter-admin/spec-review",
      "/parameter-admin/specs", "/parameter-admin/specs/identity-mapping", "/parameter-home", "/parameter-review",
      "/parameter-submissions", "/parameters", "/user-permissions"
    ];
    expect(Object.keys(viewSwitchStyleExpectations).sort()).toEqual(auditPaths);
    expect(viewSwitchStyleExpectations["/user-permissions"]).toEqual(["section", "tabs"]);
    for (const path of auditPaths) {
      expect(consistencyRoutes.find((route) => route.path === path)?.required).toContain("viewSwitchSignatures");
      const controls = signatures.filter((style) => viewSwitchStyleExpectations[path].some((variant) => variant === style.variant))
        .flatMap((style) => [measurement(style), measurement(style, false)]);
      expect(() => requireViewSwitchStyles({ viewSwitches: controls, viewSwitchSignatures: signatures }, path)).not.toThrow();
      expect(() => requireViewSwitchStyles({
        viewSwitches: [...controls, { ...controls[0], height: 43 }], viewSwitchSignatures: signatures
      }, path.includes("?") ? path : `${path}?foo=1`)).toThrow("matched 0");
    }
  });

  it.each(Object.keys(viewSwitchStyleExpectations))("rejects zero switches on expected route %s", (path) => {
    expect(() => requireViewSwitchStyles({ viewSwitches: [], viewSwitchSignatures: signatures }, path))
      .toThrow("missing consistency measurements: viewSwitches");
  });

  it.each([0, 1])("rejects a missing expected tier even with valid controls from tier %s", (index) => {
    expect(() => requireViewSwitchStyles({
      viewSwitches: [measurement(signatures[index])], viewSwitchSignatures: signatures
    }, "/organization/members")).toThrow(`missing view-switch tiers: ${index === 0 ? "tabs" : "section"}`);
  });

  it("does not let Bridge progress alone satisfy content tab coverage", () => {
    expect(() => requireViewSwitchStyles({
      viewSwitches: [{ ...measurement(), dom: "li.active", group: "ol.local-device-bridge-wizard__steps", role: "listitem" }],
      viewSwitchSignatures: signatures
    }, "/parameters")).toThrow("missing view-switch tiers: tabs");
  });

  it.each(["/organization", "/organization/members"])("rejects unrelated tiers on %s", (path) => {
    expect(() => requireViewSwitchStyles({
      viewSwitches: [measurement(signatures[2])], viewSwitchSignatures: signatures
    }, path)).toThrow("matched 0");
  });
  it.each([
    ...["/parameter-home"].map((path) => [path, "toggle"]),
    ...["/logs", "/parameters", "/parameter-review", "/parameter-submissions",
      "/parameter-admin/projects/aurora/configuration?tab=conflicts"]
      .map((path) => [path, "tabs"]),
    ...["/debugging-admin", "/debugging-admin/nodes", "/parameter-admin", "/parameter-admin/specs",
      "/parameter-admin/specs/identity-mapping", "/parameter-admin/identity-mapping", "/parameter-admin/spec-review",
      "/parameter-admin/projects", "/parameter-admin/projects/aurora/review-roles"].map((path) => [path, "section"])
  ])("enforces the migrated tier on %s: %s", (path, variant) => {
    expect(consistencyRoutes.find((route) => route.path === path)?.required).toContain("viewSwitchSignatures");
    for (const style of signatures) {
      const assertStyles = () => requireViewSwitchStyles({
        viewSwitches: [measurement(style), measurement(style, false)], viewSwitchSignatures: signatures
      }, path);
      if (style.variant === variant) expect(assertStyles).not.toThrow();
      else expect(assertStyles).toThrow("matched 0");
    }
  });

  it.each(["configuration", "files", "config-sets", "structure", "conflicts"])(
    "keeps the source-only project workbench without redundant content tabs on %s", (view) => {
      const path = `/parameter-admin/projects/aurora/${view}`;
      const required = consistencyRoutes.find((route) => route.path === path)!.required;
      expect(required).toContain("navigatorWorkbenches");
      expect(required).not.toContain("viewSwitches");
      expect(required).not.toContain("viewSwitchSignatures");
      expect(viewSwitchStyleExpectations[path]).toBeUndefined();
      expect(() => requireViewSwitchStyles({ viewSwitches: [], viewSwitchSignatures: [] }, path)).not.toThrow();
    }
  );

  it.each([
    "/parameter-admin/modules", "/parameter-admin/modules/queue", "/parameter-admin/modules/registry",
    "/parameter-admin/modules?tab=queue", "/parameter-admin/modules?tab=registry"
  ])(
    "requires both organization sections and governance content tabs on %s", (path) => {
      expect(() => requireViewSwitchStyles({
        viewSwitches: [measurement(signatures[0]), measurement(signatures[1])], viewSwitchSignatures: signatures
      }, path)).not.toThrow();
      for (const style of signatures) {
        expect(() => requireViewSwitchStyles({ viewSwitches: [measurement(style)], viewSwitchSignatures: signatures }, path)).toThrow(/matched 0|missing view-switch tiers/);
      }
      expect(() => requireViewSwitchStyles({ viewSwitches: [], viewSwitchSignatures: signatures }, path))
        .toThrow("missing consistency measurements: viewSwitches");
      expect(() => requireViewSwitchStyles({
        viewSwitches: [measurement(signatures[0]), { ...measurement(signatures[1]), height: 43 }], viewSwitchSignatures: signatures
      }, path)).toThrow("matched 0");
    }
  );

  it.each(["atlas", "aurora", "nebula"])("enforces result-mode tabs on the project route %s", (project) => {
    const path = `/parameters?project=${project}`;
    expect(() => requireViewSwitchStyles({
      viewSwitches: [measurement(signatures[1])], viewSwitchSignatures: signatures
    }, path)).not.toThrow();
    expect(() => requireViewSwitchStyles({
      viewSwitches: [measurement(signatures[2])], viewSwitchSignatures: signatures
    }, path)).toThrow("matched 0");
  });

  it.each(["/parameters", "/parameter-review"])("requires local content tabs on %s", (path) => {
    expect(() => requireViewSwitchStyles({
      viewSwitches: [measurement(signatures[1]), measurement(signatures[1], false)], viewSwitchSignatures: signatures
    }, path)).not.toThrow();
    for (const style of [signatures[0], signatures[2]]) {
      expect(() => requireViewSwitchStyles({
        viewSwitches: [measurement(style)], viewSwitchSignatures: signatures
      }, path)).toThrow("matched 0");
    }
  });
  it.each([
    "/debugging-admin", "/debugging-admin/nodes",
    "/parameter-admin", "/parameter-admin/specs", "/parameter-admin/specs/identity-mapping",
    "/parameter-admin/modules", "/parameter-admin/modules/queue", "/parameter-admin/modules/registry",
    "/parameter-admin/identity-mapping", "/parameter-admin/spec-review", "/parameter-admin/projects",
    "/parameter-admin/projects/aurora/review-roles", "/parameter-review", "/parameter-submissions"
  ])("rejects legacy styles and requires signatures on ticket #1101 route %s", (path) => {
    expect(() => requireViewSwitchStyles({
      viewSwitches: [{ ...measurement(), height: 43 }], viewSwitchSignatures: signatures
    }, path)).toThrow("matched 0");
    expect(consistencyRoutes.find((route) => route.path === path)?.required).toContain("viewSwitchSignatures");
  });

  it("keeps Bridge installation progress separate without exempting content tabs", () => {
    const progress = { ...measurement(), dom: "li.active", group: "ol.local-device-bridge-wizard__steps", role: "listitem", height: 36 };
    expect(() => requireViewSwitchStyles({
      viewSwitches: [measurement(signatures[1]), progress], viewSwitchSignatures: signatures
    }, "/parameters")).not.toThrow();
    expect(() => requireViewSwitchStyles({
      viewSwitches: [{ ...measurement(signatures[1]), height: 36 }, progress], viewSwitchSignatures: signatures
    }, "/parameters")).toThrow("matched 0");
  });

  it.each(["/parameter-home", "/logs", "/parameters"])("requires migrated switch styles and measurements on %s", (path) => {
    expect(() => requireViewSwitchStyles({
      viewSwitches: [{ ...measurement(signatures[2]), height: 30 }], viewSwitchSignatures: signatures
    }, path)).toThrow("must match exactly one view-switch style");
    expect(() => requireViewSwitchStyles({ viewSwitches: [], viewSwitchSignatures: signatures }, path))
      .toThrow("missing consistency measurements: viewSwitches");
    expect(consistencyRoutes.find((route) => route.path === path)?.required).toContain("viewSwitchSignatures");
  });

  it.each(["/organization", "/organization/members", "/parameter-home", "/logs", "/parameters"])("accepts exactly one signature for selected and unselected controls on %s", (path) => {
    expect(() => requireViewSwitchStyles({
      viewSwitches: signatures.filter((style) => viewSwitchStyleExpectations[path].some((variant) => variant === style.variant))
        .flatMap((style) => [measurement(style), measurement(style, false)]),
      viewSwitchSignatures: signatures
    }, path)).not.toThrow();
  });

  const auditFilter = (height: number) => ({ dom: "button.parameters-column-filter__trigger", role: "button", height, compactControl: "filter" });
  it("keeps audit in the compact table-filter contract after removing the toggle strip", () => {
    const required = consistencyRoutes.find((route) => route.path === "/audit")!.required;
    expect(required).toEqual(expect.arrayContaining(["filterControls", "adminLists", "rowActions", "tableScrollports"]));
    expect(required).not.toContain("viewSwitches");
    expect(required).not.toContain("viewSwitchSignatures");
    expect(viewSwitchStyleExpectations["/audit"]).toBeUndefined();
    expect(() => requireCompactControlHeights({ filterControls: [auditFilter(32)] }, "/audit")).not.toThrow();
  });
  it("rejects missing audit filter measurements", () => {
    expect(() => requireCompactControlHeights({ filterControls: [] }, "/audit"))
      .toThrow("missing consistency measurements: filterControls");
  });
  it.each([NaN, 28, 43])("rejects incorrect audit filter height %s", (height) => {
    expect(() => requireCompactControlHeights({ filterControls: [auditFilter(height)] }, "/audit")).toThrow();
  });

  it.each([
    { height: 43 }, { radius: "10px 10px 10px 10px" }, { fontSize: "16px" },
    { lineHeight: "24px" }, { fontWeight: "700" }, { background: "rgb(0, 82, 204)" },
    { role: "tab" }, { groupRole: "tablist" }
  ])("rejects drift in %j with the route and control", (drift) => {
    expect(() => requireViewSwitchStyles({
      viewSwitches: [{ ...measurement(), ...drift }], viewSwitchSignatures: signatures
    }, "/organization")).toThrow("/organization: button.organization-switch must match exactly one view-switch style (matched 0)");
  });

  it("rejects ambiguous signatures instead of accepting the first match", () => {
    expect(() => requireViewSwitchStyles({
      viewSwitches: [measurement()], viewSwitchSignatures: [signatures[0], signatures[0], signatures[2]]
    }, "/organization/members")).toThrow("matched 2");
  });

  it("rejects a local override on an unselected control", () => {
    expect(() => requireViewSwitchStyles({
      viewSwitches: [{ ...measurement(signatures[1], false), background: "rgb(238, 242, 248)" }], viewSwitchSignatures: signatures
    }, "/organization/members")).toThrow("matched 0");
  });

  it("uses resolved theme fills rather than hard-coded light colors", () => {
    const dark = signatures.map((style) => ({ ...style, background: "rgb(15, 23, 42)", selectedBackground: "rgb(76, 141, 255)" }));
    for (const [index, path] of ["/organization", "/logs", "/parameter-home"].entries()) {
      expect(() => requireViewSwitchStyles({ viewSwitches: [measurement(dark[index])], viewSwitchSignatures: dark }, path)).not.toThrow();
    }
  });

  it.each(["viewSwitches", "viewSwitchSignatures"] as const)("does not silently pass missing %s", (category) => {
    expect(() => requireViewSwitchStyles({ viewSwitches: [measurement()], viewSwitchSignatures: signatures, [category]: [] }, "/organization"))
      .toThrow(`missing consistency measurements: ${category}`);
  });

  it.each(["/parameters", "/parameter-review"])("requires formerly legacy switches after both migrations on %s", (path) => {
    expect(() => requireViewSwitchStyles({ viewSwitches: [], viewSwitchSignatures: [] }, path))
      .toThrow("missing consistency measurements: viewSwitches, viewSwitchSignatures");
  });

  it("leaves legacy switches on unmigrated routes working during expansion", () => {
    expect(() => requireViewSwitchStyles({ viewSwitches: [], viewSwitchSignatures: [] }, "/")).not.toThrow();
  });
});
