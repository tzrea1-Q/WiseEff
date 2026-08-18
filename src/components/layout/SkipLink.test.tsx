import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MAIN_CONTENT_ID } from "./landmarks";
import { SkipLink } from "./SkipLink";

afterEach(cleanup);

describe("SkipLink", () => {
  it("points at the main landmark id with Chinese copy", () => {
    render(<SkipLink />);
    const link = screen.getByRole("link", { name: "跳到主内容" });
    expect(link).toHaveAttribute("href", `#${MAIN_CONTENT_ID}`);
    expect(MAIN_CONTENT_ID).toBe("main-content");
  });
});
