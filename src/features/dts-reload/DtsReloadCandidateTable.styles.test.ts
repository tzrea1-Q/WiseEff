import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet } from "@/test/cssAssertions";

describe("DtsReloadCandidateTable action column", () => {
  it("keeps the operation column compact and centers its action", () => {
    const styles = readStylesheet("src/features/dts-reload/dts-reload-candidate-table.css");
    const header = declarationsFor(
      styles,
      ".dts-reload-candidate-table__grid th:last-child"
    );
    const cell = declarationsFor(
      styles,
      ".dts-reload-candidate-table__grid td:last-child"
    );

    expect(header.width).toBe("96px");
    expect(header["min-width"]).toBe("96px");
    expect(header["max-width"]).toBe("96px");
    expect(header["text-align"]).toBe("center");
    expect(cell["text-align"]).toBe("center");
  });
});
