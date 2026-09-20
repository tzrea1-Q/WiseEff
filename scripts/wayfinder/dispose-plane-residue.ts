/**
 * Operator seam for T2.3b residue disposal. Helper PG only. Never DROP.
 *
 *   DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:55438/<db> \
 *     npx tsx scripts/wayfinder/dispose-plane-residue.ts --project aurora --approval-ref closeout-c4
 */
import { pathToFileURL } from "node:url";

import { createObjectStoreFromEnv } from "../../server/objectStoreFactory";
import { createPostgresDatabase } from "../../server/shared/database/client";
import type { AuthContext } from "../../server/modules/auth/types";
import { captureProjectParameterPlane } from "../../server/modules/parameter-bindings/seedInitialization/archive";
import {
  disposeProjectParameterPlaneResidue,
  planProjectParameterPlaneDisposal,
} from "../../server/modules/parameter-bindings/seedInitialization/dispose";

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function requireHelperUrl(url: string): void {
  if (!url.includes("127.0.0.1:55438") && !url.includes("localhost:55438")) {
    throw new Error("T2.3b closeout disposer refuses DATABASE_URL that is not helper PG 55438");
  }
  if (url.includes(":5432") || /\/wiseeff$/.test(url.split("?")[0] ?? "")) {
    throw new Error("T2.3b closeout disposer refuses 5432/wiseeff");
  }
}

function operatorAuth(organizationId: string): AuthContext {
  return {
    user: {
      id: "u-xu-yun",
      organizationId,
      name: "Xu Yun",
      email: "xu@chargelab.cn",
      title: "Platform Owner",
      isActive: true,
    },
    organization: { id: organizationId, name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit"],
  };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  requireHelperUrl(url);
  const projectId = arg("--project");
  const approvalRef = arg("--approval-ref");
  const organizationId = process.env.WISEEFF_ORGANIZATION_ID?.trim() || "org-chargelab";
  const db = createPostgresDatabase(url);
  const store = createObjectStoreFromEnv(process.env);
  const auth = operatorAuth(organizationId);
  const operator = { role: "cutover-operator" as const, approvalRef };
  const archive = await captureProjectParameterPlane(db, store, auth, { projectId });
  const plan = await planProjectParameterPlaneDisposal(db, store, auth, operator, {
    projectId,
    archiveId: archive.archiveId,
    archiveDigest: archive.archiveDigest,
  });
  const residueCount = Object.values(plan.residue).reduce((sum, ids) => sum + ids.length, 0);
  const first = await disposeProjectParameterPlaneResidue(db, store, auth, operator, {
    projectId,
    archiveId: archive.archiveId,
    archiveDigest: archive.archiveDigest,
  });
  const replay = await disposeProjectParameterPlaneResidue(db, store, auth, operator, {
    projectId,
    archiveId: archive.archiveId,
    archiveDigest: archive.archiveDigest,
  });
  console.log(
    JSON.stringify(
      {
        projectId,
        archiveId: archive.archiveId,
        archiveDigest: archive.archiveDigest,
        residueCount,
        firstPhase: first.phase,
        replayPhase: replay.phase,
        dropTable: false,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
