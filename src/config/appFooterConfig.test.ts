import { describe, expect, it, vi } from "vitest";

import { resolveAppFooterConfig } from "./appFooterConfig";

describe("application footer configuration", () => {
  it("uses safe local presentation defaults", () => {
    expect(resolveAppFooterConfig({}, "0.1.0")).toEqual({
      contact: null,
      copyrightOwner: "雷泽（WiseEff）",
      version: "v0.1.0"
    });
  });

  it("trims deployment metadata and normalizes the version prefix", () => {
    expect(
      resolveAppFooterConfig(
        {
          VITE_WISEEFF_APP_VERSION: " v1.4.0-pilot.3 ",
          VITE_WISEEFF_FOOTER_COPYRIGHT_OWNER: " ChargeLab Technology Co., Ltd. "
        },
        "0.1.0"
      )
    ).toMatchObject({
      copyrightOwner: "ChargeLab Technology Co., Ltd.",
      version: "v1.4.0-pilot.3"
    });
  });

  it("collapses repeated version prefixes to exactly one lowercase v", () => {
    expect(resolveAppFooterConfig({ VITE_WISEEFF_APP_VERSION: "vvV1.4.0" }, "0.1.0").version).toBe("v1.4.0");
  });

  it.each([
    [" https://support.example.com/help ", { href: "https://support.example.com/help", kind: "https" }],
    ["mailto:support@example.com", { href: "mailto:support@example.com", kind: "mailto" }]
  ] as const)("accepts the public contact protocol in %s", (configuredHref, expectedContact) => {
    expect(
      resolveAppFooterConfig({ VITE_WISEEFF_CONTACT_HREF: configuredHref }, "0.1.0").contact
    ).toEqual(expectedContact);
  });

  it.each(["http://support.example.com", "javascript:alert(1)", "/support"])(
    "hides an unsafe contact value and warns only in development: %s",
    (configuredHref) => {
      const developmentWarning = vi.fn();
      const productionWarning = vi.fn();

      expect(
        resolveAppFooterConfig({ VITE_WISEEFF_CONTACT_HREF: configuredHref }, "0.1.0", {
          development: true,
          warn: developmentWarning
        }).contact
      ).toBeNull();
      expect(developmentWarning).toHaveBeenCalledWith(
        "VITE_WISEEFF_CONTACT_HREF must use https: or mailto:; the footer contact link is hidden."
      );

      resolveAppFooterConfig({ VITE_WISEEFF_CONTACT_HREF: configuredHref }, "0.1.0", {
        development: false,
        warn: productionWarning
      });
      expect(productionWarning).not.toHaveBeenCalled();
    }
  );
});
