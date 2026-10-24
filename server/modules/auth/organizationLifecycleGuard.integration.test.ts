import { describe, expect, it } from "vitest";
import { withTempDatabase } from "../../testing/tempDatabase";

describe("organization lifecycle database ownership admission", () => {
  it("distinguishes a missing owner from suspended business and keeps unknown ownership fail closed", async () => {
    await withTempDatabase({ prefix: "lifecycle_owner" }, async ({ db }) => {
      await db.query(`insert into organizations(id,name) values('owner-active','Active'),('owner-suspended','Suspended');
        update organizations set status='suspended' where id='owner-suspended';
        create temporary table lifecycle_probe(id text,organization_id text);
        create trigger organization_lifecycle_guard before insert on lifecycle_probe
          for each row execute function public.guard_organization_lifecycle()`);
      await expect(db.query("insert into lifecycle_probe values('missing','owner-missing')"))
        .rejects.toMatchObject({ code: "23503", message: "Organization was not found" });
      await expect(db.query("insert into lifecycle_probe values('suspended','owner-suspended')"))
        .rejects.toMatchObject({ code: "55000", message: "Organization is suspended" });
      await db.query("insert into lifecycle_probe values('active','owner-active')");
      expect((await db.query("select id from lifecycle_probe")).rows).toEqual([{ id: "active" }]);
    });
  });
});
