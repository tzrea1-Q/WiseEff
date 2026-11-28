import { describe, expect, it } from "vitest";
import { canBindArtifact } from "./artifactByteTransport";

describe("artifact write size", () => {
  it("includes binary and UTF-8 parameter sizes and protocol framing before the insert", () => {
    const fields = ["目录", null, "typed-changeset"];
    const maxMessageBytes = 0x3ffffffe;
    const maxArtifactBytes = maxMessageBytes - (14 + 6 * 5 + 71 + 6 + 15);
    expect(canBindArtifact(maxArtifactBytes, fields)).toBe(true);
    expect(canBindArtifact(maxArtifactBytes + 1, fields)).toBe(false);
    expect(canBindArtifact(1200 * 1024 * 1024, fields)).toBe(false);
  });
});
