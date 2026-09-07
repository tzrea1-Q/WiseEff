import { beforeEach, expect, it, vi } from "vitest";
const factory = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../../../shared/database/client", () => ({ createPostgresDatabase: factory.create }));
import { openStartupReportDatabase } from "./reportConnection";

const safe = { same_identity: true, reader_capability: true, forbidden_roles: 0,
  invalid_memberships: 0, owned_objects: 0, missing_report_reads: 0,
  unexpected_direct_reads: 0, effective_writes: 0, unsafe_definers: 0, unsafe_parameters: 0 };
const url = "postgresql://synthetic:private-secret@isolated.invalid/reports";
let db: { query: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
beforeEach(() => {
  factory.create.mockReset();
  db = { query: vi.fn(async () => ({ rows: [{ ...safe }], rowCount: 1 })), close: vi.fn(async () => undefined) };
  factory.create.mockReturnValue(db);
});

it("does not expose a report reader with a reachable verification writer", async () => {
  db.query.mockResolvedValue({ rows: [{ ...safe, forbidden_roles: 1 }], rowCount: 1 });
  await expect(openStartupReportDatabase({ connectionString: url })).rejects.toThrow("PCAT-REPORT-LOGIN-ROLE-REJECTED");
  expect(db.close).toHaveBeenCalledOnce();
});

it("returns the actual checked root without querying a startup report or starting effects", async () => {
  const opened = await openStartupReportDatabase({ connectionString: url });
  expect(opened).toBe(db);
  expect(factory.create).toHaveBeenCalledWith(url, undefined);
  expect(db.query).toHaveBeenCalledOnce();
  expect(db.query.mock.calls[0][1]).toEqual([[
    "verification_gate_registry", "verification_plans", "verification_attempts",
    "verification_gate_results", "verification_reports", "verification_approvals",
  ]]);
  expect(db.close).not.toHaveBeenCalled();
  await opened.close(); // The caller owns lifetime after successful admission.
  expect(db.close).toHaveBeenCalledOnce();
});

it.each([
  ["same_identity", false, "ROLE-REJECTED"],
  ["reader_capability", false, "ROLE-REJECTED"],
  ["invalid_memberships", 1, "ROLE-REJECTED"],
  ["owned_objects", 1, "OBJECT-OWNER"],
  ["missing_report_reads", 1, "CAPABILITY-REJECTED"],
  ["unexpected_direct_reads", 1, "CAPABILITY-REJECTED"],
  ["effective_writes", 1, "CAPABILITY-REJECTED"],
  ["unsafe_definers", 1, "CAPABILITY-REJECTED"],
  ["unsafe_parameters", 1, "CAPABILITY-REJECTED"],
])("closes before refusing %s", async (field, value, suffix) => {
  db.query.mockResolvedValue({ rows: [{ ...safe, [field as string]: value }], rowCount: 1 });
  await expect(openStartupReportDatabase({ connectionString: url })).rejects.toThrow(`PCAT-REPORT-LOGIN-${suffix}`);
  expect(db.close).toHaveBeenCalledOnce();
});

it.each([undefined, null, -1, "0", Number.NaN])("rejects incomplete audit results rather than treating %s as zero", async value => {
  db.query.mockResolvedValue({ rows: [{ ...safe, unsafe_parameters: value }], rowCount: 1 });
  await expect(openStartupReportDatabase({ connectionString: url })).rejects.toThrow("QUERY-FAILED");
  expect(db.close).toHaveBeenCalledOnce();
});

it.each([0, 2, null])("rejects an unexpected identity result cardinality %s", async rowCount => {
  db.query.mockResolvedValue({ rows: [{ ...safe }], rowCount });
  await expect(openStartupReportDatabase({ connectionString: url })).rejects.toThrow("QUERY-FAILED");
  expect(db.close).toHaveBeenCalledOnce();
});

it("preserves the admission refusal even when close fails with a private error", async () => {
  db.query.mockResolvedValue({ rows: [{ ...safe, forbidden_roles: 1 }], rowCount: 1 });
  db.close.mockRejectedValue(new Error(url));
  await expect(openStartupReportDatabase({ connectionString: url })).rejects.toThrow(/^PCAT-REPORT-LOGIN-ROLE-REJECTED$/);
  expect(db.close).toHaveBeenCalledOnce();
});

it("redacts query and pool close diagnostics", async () => {
  db.query.mockRejectedValue(new Error(url)); db.close.mockRejectedValue(new Error("private-close-secret"));
  await expect(openStartupReportDatabase({ connectionString: url })).rejects.toThrow(/^PCAT-REPORT-LOGIN-QUERY-FAILED$/);
  expect(db.close).toHaveBeenCalledOnce();
});

it("redacts constructor failures", async () => {
  factory.create.mockImplementation(() => { throw new Error(url); });
  await expect(openStartupReportDatabase({ connectionString: url })).rejects.toThrow(/^PCAT-REPORT-LOGIN-QUERY-FAILED$/);
  expect(db.close).not.toHaveBeenCalled();
});

it.each(["", "postgresql:///reports", "postgresql://isolated.invalid/reports", "postgresql://reader@isolated.invalid", "file:///private-config"])("requires an explicit database endpoint: %s", async connectionString => {
  await expect(openStartupReportDatabase({ connectionString })).rejects.toThrow(/^PCAT-REPORT-LOGIN-(CONFIG-REJECTED|QUERY-FAILED)$/);
  expect(factory.create).not.toHaveBeenCalled();
});
