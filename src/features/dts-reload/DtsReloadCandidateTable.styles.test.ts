import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet } from "@/test/cssAssertions";

describe("DtsReloadCandidateTable action column", () => {
  it("keeps the operation column compact and centers its action", () => {
    const styles = readStylesheet("src/features/dts-reload/dts-reload-candidate-table.css");
    const header = declarationsFor(
      styles,
      ".dts-reload-candidate-table__grid th:last-child"
    );

    expect(header.width).toBe("var(--space-16)");
    expect(header["min-width"]).toBe("var(--space-16)");
    expect(header["max-width"]).toBe("var(--space-16)");
  });
});
