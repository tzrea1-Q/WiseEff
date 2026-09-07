import { expect, it } from "vitest";
import { legacyRolesAreRecoverable, type RetiringRole } from "./roleRecovery";

const actual = (): RetiringRole => ({ oid: "17000", name: "old_app", login: true, inherit: true, privileged: false,
  callers: [{ oid: "17000", name: "old_app" }, { oid: "17001", name: "old_job" }],
  members: [{ name: "old_job", inherit: false, set: true, admin: false }] });
const packaged = () => [{ name: "old_app", login: true, inherit: true, members: [{ name: "old_job", inherit: false, set: true }] }];
it("requires the exact original LOGIN and PG16 membership capability in the package", () => {
  expect(legacyRolesAreRecoverable([actual()], packaged())).toBe(true);
});
it.each(["bootstrap", "privileged", "nologin", "admin", "inherit", "set", "member", "missing", "duplicate", "oid-array"])("refuses non-restorable %s", fault => {
  const rows = [actual()]; const backup = packaged();
  if (fault === "bootstrap") rows[0].oid = "10";
  if (fault === "privileged") rows[0].privileged = true;
  if (fault === "nologin") rows[0].login = false;
  if (fault === "admin") rows[0].members[0].admin = true;
  if (fault === "inherit") rows[0].inherit = false;
  if (fault === "set") rows[0].members[0].set = false;
  if (fault === "member") rows[0].members[0].name = "other";
  if (fault === "missing") backup.length = 0;
  if (fault === "duplicate") rows.push(actual());
  if (fault === "oid-array") rows[0].oid = ["17000"] as unknown as string;
  expect(legacyRolesAreRecoverable(rows, backup)).toBe(false);
});
