import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { initialState } from "@/mockData";
import { LogsPage } from "./LogsPage";

afterEach(cleanup);

it("keeps permitted revision and page references as text when knowledge is unpublished", async () => {
  const onNavigate = vi.fn();
  const log = { ...initialState.logs[0], status: "Complete" as const, stage: "report" as const,
    knowledgeRevisions: [{ entryId: "hidden-entry", pages: [99] },
      { entryId: "visible-entry", revisionId: "historical-revision", pages: [3, 7] },
      { entryId: "second-entry", revisionId: "second-revision" }] };
  render(<LogsPage search="" state={{ ...initialState, activeRoleId: "user", logs: [log] }} dispatch={() => undefined}
    onNavigate={onNavigate} canOpenKnowledge={false} />);
  await userEvent.click(screen.getByText("实际检索的知识修订（3）"));
  const provenance = screen.getByText("实际检索的知识修订（3）").closest("details")!;
  expect(within(provenance).getAllByText("知识条目（已固定修订）")).toHaveLength(2);
  expect(provenance).toHaveTextContent("第 3、7 页");
  expect(within(provenance).getByText("无权查看的条目")).toBeInTheDocument();
  expect(provenance).not.toHaveTextContent("99");
  expect(within(provenance).queryByRole("link")).not.toBeInTheDocument();
  expect(within(provenance).queryByRole("button")).not.toBeInTheDocument();
  expect(onNavigate).not.toHaveBeenCalled();
});

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

it("shows recorded pages and opens each at its pinned revision, hiding pages with an unreadable revision", async () => {
  const onNavigate = vi.fn();
  const log = { ...initialState.logs[0], status: "Complete" as const, stage: "report" as const,
    knowledgeRevisions: [{ entryId: "hidden-entry", pages: [99] },
      { entryId: "visible-entry", revisionId: "historical-revision", pages: [3, 7] }] };
  render(<LogsPage search="" state={{ ...initialState, activeRoleId: "user", logs: [log] }} dispatch={() => undefined} onNavigate={onNavigate} />);
  await userEvent.click(screen.getByText("实际检索的知识修订（2）"));
  const provenance = screen.getByText("实际检索的知识修订（2）").closest("details")!;
  expect(provenance).toHaveTextContent("第 3、7 页");
  expect(within(provenance).getByRole("link", { name: "查看知识条目（已固定修订）" })).toHaveAttribute(
    "href", "/knowledge?entryId=visible-entry&revisionId=historical-revision&page=3");
  expect(provenance).not.toHaveTextContent("99");
  for (const page of [3, 7]) {
    const href = `/knowledge?entryId=visible-entry&revisionId=historical-revision&page=${page}`;
    const link = within(provenance).getByRole("link", { name: `打开第 ${page} 页` });
    expect(link).toHaveAttribute("href", href);
    await userEvent.click(link);
    expect(onNavigate).toHaveBeenLastCalledWith(href);
  }
});
