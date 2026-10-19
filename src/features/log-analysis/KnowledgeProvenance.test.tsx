import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { initialState } from "@/mockData";
import { LogsPage } from "./LogsPage";

afterEach(cleanup);

it("shows opaque unreadable knowledge references alongside visible revisions", () => {
  const log = { ...initialState.logs[0], status: "Complete" as const, stage: "report" as const,
    knowledgeRevisions: [{ entryId: "hidden-entry" }, { entryId: "visible-entry", revisionId: "visible-revision" }] };
  render(<LogsPage search="" state={{ ...initialState, activeRoleId: "user", logs: [log] }} dispatch={() => undefined} onNavigate={() => undefined} />);
  const provenance = screen.getByText("实际检索的知识修订（2）").closest("details")!;
  expect(within(provenance).getByText("无权查看的条目 · hidden-entry")).toBeInTheDocument();
  expect(within(provenance).getByText("条目 visible-entry · 修订 visible-revision")).toBeInTheDocument();
  expect(provenance).not.toHaveTextContent("undefined");
});
