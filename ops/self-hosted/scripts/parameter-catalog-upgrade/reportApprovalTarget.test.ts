import { expect, it } from "vitest";
import { approveDeploymentReport, openReportApprovalTarget } from "./reportApprovalTarget";

it("rejects an arbitrary object before it can execute a report action", async () => {
  let called = false;
  await expect(approveDeploymentReport({ approve() { called = true; } }, {} as never))
    .rejects.toMatchObject({ code: "PCAT-REPORT-APPROVAL-TARGET-REJECTED" });
  expect(called).toBe(false);
});

it.each(["missing-url", "physical-binding", "ambient-url"])("refuses %s before connecting", async fault => {
  const options = { physicalTarget: { systemIdentifier: "12", databaseOid: "34" }, managementConnectionString: "", writerConnectionString: "" };
  if (fault === "physical-binding") options.physicalTarget.databaseOid = "invalid";
  if (fault === "ambient-url") options.writerConnectionString = "postgresql:///ambient";
  await expect(openReportApprovalTarget(options)).rejects.toMatchObject({ code: "PCAT-REPORT-APPROVAL-CONFIG-REJECTED" });
});
