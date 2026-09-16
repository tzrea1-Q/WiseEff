/** Browser layout coverage selection, separate from runtime/evidence ownership. */
export type QualityViewport = {
  readonly name: "desktop" | "compact" | "tablet" | "mobile";
  readonly width: number;
  readonly height: number;
};

/** Pure function: callers provide the setting; returned arrays never share state. */
export function qualityViewports(profile: string | undefined): [QualityViewport, ...QualityViewport[]] {
  switch (profile ?? "desktop") {
    case "desktop":
      return [{ name: "desktop", width: 1440, height: 900 }];
    case "compact":
      return [{ name: "compact", width: 1280, height: 800 }];
    case "extended":
      return [
        { name: "desktop", width: 1440, height: 900 },
        { name: "tablet", width: 834, height: 1112 },
        { name: "mobile", width: 390, height: 844 }
      ];
    default:
      // Do not echo arbitrary environment values into CI logs.
      throw new Error("WISEEFF_QUALITY_VIEWPORT_PROFILE must be desktop, compact, or extended.");
  }
}
