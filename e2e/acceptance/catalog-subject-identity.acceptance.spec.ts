import "./helpers/loadAcceptanceEnvironment";
import { expect } from "playwright/test";
import { catalogAppUrl, catalogRuntimeTest as test } from "./helpers/catalogFixtureRuntime";
import { assertNoPageOverflow, CATALOG_EXPECTED_API_FAILURES, catalogScreenshot, confirmGovernanceDialog, openCatalogAt, signInCatalogActor } from "./helpers/catalogBrowser";
import { useBrowserDiagnostics } from "./helpers/browserDiagnostics";
import { signInBrowserAsUser } from "./helpers/bearerAuth";
import { ACCEPTANCE_ORGANIZATION, acceptanceCast } from "./helpers/cast";
import { seedAcceptanceRoleMatrix } from "./helpers/roleFixtures";
import { compileLocalizedVendorCatalogSuccessor } from "../../scripts/compile-vendor-catalog-release";
import { createPostgresDatabase, getRootPostgresPool } from "../../server/shared/database/client";
import { seedPublishedCatalog } from "../../server/testing/parameterCatalog/seedPublishedCatalog";
import { getAuthContext } from "../../server/modules/auth/repository";
import { createUserInvocation } from "../../server/modules/auth/trustedInvocation";
import { adoptPreexistingCatalog } from "../../server/modules/catalog-publication/runtime/adoption";
import { revisePublicationPolicy } from "../../server/modules/catalog-publication/authorization/policy";
import { collectPublicationPolicyInstanceSnapshot } from "../../server/modules/catalog-publication/authorization/instanceSnapshot";
import { MANAGED_INSTANCE_POLICY_CONFIRMATION } from "../../server/modules/catalog-publication/authorization/types";
import { encodeBundleBytes } from "../../server/modules/catalog-publication/builder/bundleCodec";
import { CATALOG_CAPABILITY_CONTRACT_REVISION } from "../../server/modules/catalog-publication/builder/types";
import { runPublicationManagerOnce } from "../../server/modules/catalog-publication/jobs/manager";
import { createCatalogInstaller } from "../../server/modules/catalog-kernel/install/installer";
import { CatalogSubjectId } from "../../server/modules/parameter-catalog-contract";
import { createRegistrationService } from "../../server/modules/parameter-governance/registration/service";

test.use({ catalogRuntimeScope: import.meta.url, catalogRuntimeDatabaseUrl: process.env.TEST_DATABASE_URL,
  viewport: { width: 1440, height: 900 } });
useBrowserDiagnostics(test, { expectedApiFailures: CATALOG_EXPECTED_API_FAILURES });

test("reviews Huawei shared aliases and driver rules from module management", async ({ page, catalogRuntime }, testInfo) => {
  test.setTimeout(180_000);
  const db = createPostgresDatabase(catalogRuntime.databaseUrl);
  const pool = getRootPostgresPool(db)!;
  const { id: organizationId } = ACCEPTANCE_ORGANIZATION;
  const author = acceptanceCast.platformOperator;
  const reviewer = acceptanceCast.xuYun;
  const name = "huawei,direct_charger";
  const subjectId = "csub_drv_huawei_direct_charger";
  const route = `/parameter-admin/modules?selectedSubject=${subjectId}`;
  try {
    await seedAcceptanceRoleMatrix();
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('alias-browser-reviewer',$1,$2,'platform-admin')",
      [reviewer.userId, organizationId]);
    const pin = await seedPublishedCatalog(pool);
    const vendor = compileLocalizedVendorCatalogSuccessor();
    const adopted = await adoptPreexistingCatalog(pool, { expectedCurrent: pin, actorPrincipalId: author.userId,
      sourceBytes: encodeBundleBytes(vendor.bundle), artifactDigest: pin.digest, evidenceKind: "synthetic-fixture",
      adoptionEvidence: { source_bundle_digest: pin.digest, verification_digest: vendor.compiled.materializationFingerprint,
        data_mode: "fresh", collected_at: new Date().toISOString(), approved_by: author.userId } });
    expect(adopted.ok, JSON.stringify(adopted)).toBe(true);
    const instance = await collectPublicationPolicyInstanceSnapshot(db);
    const operator = createUserInvocation(await getAuthContext(db, author.userId));
    expect((await revisePublicationPolicy(db, { trustedActor: operator,
      publicationEnabled: true, lowRiskSingleActorPublish: false, capabilityContractRevision: CATALOG_CAPABILITY_CONTRACT_REVISION,
      mode: "execute", managedInstance: { confirmation: MANAGED_INSTANCE_POLICY_CONFIRMATION, expectedDatabaseOid: instance.databaseOid,
        expectedCurrentId: pin.id, expectedCurrentDigest: pin.digest, expectedPolicyRevision: instance.policyRevision,
        expectedFrozen: instance.frozen, expectedAdopted: instance.adopted } })).ok).toBe(true);
    await db.query("insert into parameter_modules(id,organization_id,name,path,depth,kind,origin) values ('huawei-identity',$1,'Huawei','huawei-identity',1,'business','curated')", [organizationId]);
    const registered = await createRegistrationService(pool).execute({ kind: "register", organizationId, subjectId: CatalogSubjectId(subjectId),
      subjectKind: "driver", expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: "huawei-identity",
      method: "explicit", displayAlias: "direct_charger", proof: {}, idempotencyKey: "browser-identity-registration",
      context: { actorKind: "platform-admin", principalId: author.userId } });
    expect(registered.ok, JSON.stringify(registered)).toBe(true);
    await db.query(`insert into public.registration_recognition_rules
      (organization_id,registration_id,canonical_subject_id,compatibles,driver_nature,instance_cardinality)
      select organization_id,id,subject_id,array['direct_charger'],'physical-device','multiple'
      from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2`, [organizationId, subjectId]);

    await openCatalogAt(page, "platform-admin");
    const importButton = page.getByRole("button", { name: "批量导入定义", exact: true });
    await importButton.focus();
    await page.keyboard.press("Enter");
    const importer = page.getByRole("dialog", { name: "批量导入定义", exact: true });
    await importer.getByLabel("Markdown 文档").fill("# Driver `direct_charger`\n## `support_series_bat_mode` 串联电池模式\n| 字段 | 值 |\n| --- | --- |\n| 类型 | boolean |");
    await importer.getByRole("button", { name: "解析并预览" }).click();
    await importer.getByRole("combobox", { name: "direct_charger 的组织匹配主体" }).click();
    await page.getByRole("option", { name: /huawei,direct_charger/ }).click();
    await importer.getByRole("button", { name: "解析并预览" }).click();
    await expect(importer.getByText("组织 compatible 规则 · huawei,direct_charger")).toBeVisible();
    await assertNoPageOverflow(page);
    await catalogScreenshot(page, testInfo, "huawei-organization-match-1440x900");

    await signInCatalogActor(page, "platform-admin", route);
    await page.getByRole("button", { name: `共享标识：${name}` }).click();
    const identity = page.getByRole("dialog", { name: `共享标识：${name}` });
    await identity.getByRole("combobox", { name: "共享标识操作" }).click();
    await page.getByRole("option", { name: "新增正式别名" }).click();
    await identity.getByLabel("正式别名", { exact: true }).fill("direct_charger");
    await identity.getByRole("button", { name: "生成发布预览" }).click();
    await confirmGovernanceDialog(page, "确认预览");
    const preview = identity.getByRole("region", { name: "共享标识发布预览" });
    await expect(preview).toContainText("正式目录别名 direct_charger 将启用");
    const candidateId = await preview.locator("code").first().textContent();
    expect(candidateId).toMatch(/^ccand_/u);
    await assertNoPageOverflow(page);
    await catalogScreenshot(page, testInfo, "huawei-shared-alias-preview-1440x900");

    await signInBrowserAsUser(page, reviewer.userId, reviewer.email, reviewer.name, catalogAppUrl(route));
    await page.getByRole("button", { name: `共享标识：${name}` }).click();
    await identity.getByText("复核已有共享标识候选").click();
    await identity.getByLabel("候选编号").fill(candidateId!);
    await identity.getByRole("button", { name: "读取待审核候选" }).click();
    await identity.getByRole("button", { name: "提交发布" }).click();
    await confirmGovernanceDialog(page, "确认发布");
    await expect(identity.getByRole("status")).toContainText("发布已入队");
    expect(await runPublicationManagerOnce({ db, pool, installer: createCatalogInstaller(pool),
      resolvePublisherActor: async (id) => createUserInvocation(await getAuthContext(db, id)) })).toBe("claimed");
    await expect(identity.getByRole("status")).toContainText("目录发布已生效", { timeout: 30_000 });
    await expect(identity.getByText("direct_charger（启用）", { exact: true })).toBeVisible();
    await catalogScreenshot(page, testInfo, "huawei-shared-alias-active-1440x900");

    await signInCatalogActor(page, "platform-admin", route);
    await page.getByRole("button", { name: `共享标识：${name}` }).click();
    await identity.getByRole("combobox", { name: "共享标识操作" }).click();
    await page.getByRole("option", { name: "修订驱动默认规则" }).click();
    await identity.getByRole("combobox", { name: "驱动性质" }).click();
    await page.getByRole("option", { name: "逻辑服务" }).click();
    await identity.getByRole("combobox", { name: "项目实例规则" }).click();
    await page.getByRole("option", { name: "每项目单例" }).click();
    await identity.getByRole("button", { name: "生成发布预览" }).press("Enter");
    await confirmGovernanceDialog(page, "确认预览");
    await expect(preview).toContainText("当前规则 驱动 · 生效 · 物理设备 · 多实例");
    await expect(preview).toContainText("发布后 驱动 · 生效 · 逻辑服务 · 每项目单例");
    await preview.getByText("当前组织登记与覆盖").click();
    await expect(preview).toContainText("组织多实例");
    const rulesCandidateId = await preview.getByText(/^候选编号/u).locator("code").first().textContent();
    expect(rulesCandidateId).toMatch(/^ccand_/u);
    await assertNoPageOverflow(page);
    await catalogScreenshot(page, testInfo, "huawei-shared-driver-rules-preview-1440x900");

    await signInBrowserAsUser(page, reviewer.userId, reviewer.email, reviewer.name, catalogAppUrl(route));
    await page.getByRole("button", { name: `共享标识：${name}` }).click();
    await identity.getByText("复核已有共享标识候选").click();
    await identity.getByLabel("候选编号").fill(rulesCandidateId!);
    await identity.getByRole("button", { name: "读取待审核候选" }).click();
    await expect(preview).toContainText("逻辑服务 · 每项目单例");
    await identity.getByRole("button", { name: "提交发布" }).click();
    await confirmGovernanceDialog(page, "确认发布");
    await expect(identity.getByRole("status")).toContainText("发布已入队");
    expect(await runPublicationManagerOnce({ db, pool, installer: createCatalogInstaller(pool),
      resolvePublisherActor: async (id) => createUserInvocation(await getAuthContext(db, id)) })).toBe("claimed");
    await expect(identity.getByRole("status")).toContainText("目录发布已生效", { timeout: 30_000 });
    await catalogScreenshot(page, testInfo, "huawei-shared-driver-rules-active-1440x900");
  } finally {
    await db.close();
  }
});
