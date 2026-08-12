import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { XiaozeCitationSources, readCitationsFromMetadata } from "./XiaozeCitationSources";

describe("XiaozeCitationSources", () => {
  it("renders knowledge citations as deep links into /knowledge", () => {
    render(
      <XiaozeCitationSources
        citations={[
          {
            type: "knowledge",
            id: "kb-1",
            label: "快充温控调参经验",
            href: "/knowledge?entryId=kb-1",
            snippet: "当电池温度超过 45 度时降流。"
          }
        ]}
      />
    );

    const sources = screen.getByLabelText("引用来源");
    expect(sources).toHaveTextContent("来源");
    const link = screen.getByRole("link", { name: "快充温控调参经验" });
    expect(link).toHaveAttribute("href", "/knowledge?entryId=kb-1");
    expect(link).toHaveAttribute("title", "当电池温度超过 45 度时降流。");
  });

  it("renders href-less citations as plain chips and dedupes by type+id", () => {
    render(
      <XiaozeCitationSources
        citations={[
          { type: "parameter", id: "p-1", label: "charge_current" },
          { type: "parameter", id: "p-1", label: "charge_current" },
          { type: "log", id: "log-1", label: "Charging timeout", href: "/logs?logId=log-1" }
        ]}
      />
    );

    expect(screen.getAllByText("charge_current")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "charge_current" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Charging timeout" })).toBeInTheDocument();
  });

  it("renders nothing without citations", () => {
    const { container } = render(<XiaozeCitationSources citations={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("readCitationsFromMetadata", () => {
  it("reads well-formed citations and drops malformed entries", () => {
    const citations = readCitationsFromMetadata({
      citations: [
        { type: "knowledge", id: "kb-1", label: "条目", href: "/knowledge?entryId=kb-1" },
        { id: 42, label: "bad" },
        "junk"
      ]
    });
    expect(citations).toEqual([{ type: "knowledge", id: "kb-1", label: "条目", href: "/knowledge?entryId=kb-1" }]);
  });

  it("returns empty for absent metadata", () => {
    expect(readCitationsFromMetadata(undefined)).toEqual([]);
    expect(readCitationsFromMetadata({})).toEqual([]);
  });
});
