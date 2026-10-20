import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { initialState } from "@/mockData";
import { LogsPage } from "./LogsPage";

afterEach(cleanup);

it("shows opaque unreadable knowledge references alongside visible revisions", async () => {
  const log = { ...initialState.logs[0], status: "Complete" as const, stage: "report" as const,
    knowledgeRevisions: [{ entryId: "hidden-entry" }, { entryId: "visible-entry", revisionId: "visible-revision" }] };
  render(<LogsPage search="" state={{ ...initialState, activeRoleId: "user", logs: [log] }} dispatch={() => undefined} onNavigate={() => undefined} />);
  const provenance = screen.getByText("实际检索的知识修订（2）").closest("details")!;
  await userEvent.click(screen.getByText("实际检索的知识修订（2）"));
  expect(within(provenance).getByText("无权查看的条目")).toBeInTheDocument();
  expect(within(provenance).getAllByRole("listitem")).toHaveLength(2);
  expect(within(provenance).getAllByRole("link")).toHaveLength(1);
  expect(within(provenance).getByRole("link", { name: "查看知识条目（已固定修订）" })).toHaveAttribute("href", "/knowledge?entryId=visible-entry");
  expect(provenance).not.toHaveTextContent("hidden-entry");
  expect(provenance).not.toHaveTextContent("visible-revision");
  expect(provenance).not.toHaveTextContent("undefined");
});
