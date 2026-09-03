#!/usr/bin/env bash
# WiseEff self-hosted upgrade entry. The implementation lives in upgrade-lib.sh
# so the launcher can be replaced safely when a target checkout changes.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=upgrade-lib.sh
source "${script_dir}/upgrade-lib.sh"

eval "$(declare -f wiseeff_upgrade_usage | sed '1s/.*/wiseeff_upgrade_stack_usage ()/')"
eval "$(declare -f wiseeff_upgrade_main | sed '1s/.*/wiseeff_upgrade_stack_main ()/')"

wiseeff_upgrade_usage() {
  wiseeff_upgrade_stack_usage
  cat <<'EOF'

Catalog apply (fresh XOR populated; never a silent default):
  apply --catalog-apply-mode fresh|populated
  apply --catalog-apply                 Fail closed until a single mode is supplied.

Catalog options:
  --catalog-apply-mode MODE             Exactly one of fresh or populated.
  --catalog-apply                       Request catalog apply without selecting a mode.
  --catalog-journal PATH                Upgrade controller journal path.
  --catalog-graph PATH                  Frozen P0 graph JSON.
  --catalog-release-json PATH           Catalog Release bundle JSON.
  --catalog-run-id ID                   Catalog apply journal run id.
  --catalog-target-artifact-sha SHA     40-character lowercase git SHA.
  --catalog-target-release-digest DIGEST
  --catalog-archive-root PATH
  --catalog-archive-key-hex HEX
  --catalog-operator-audit-ref REF

Catalog apply is one-shot plan → execute → P11a only. inspect/recover/resume
belong to S11-REC. P11-P16, gate selection, API/startup migration, and
unknown-commit guesses are refused.

WISEEFF_CATALOG_QUIESCED=true is a required operator attestation that writers,
queue, and proxy are quiesced. It is not P2 proof. Catalog apply fails closed
without it.
EOF
}

wiseeff_catalog_upgrade_refuse() {
  local code="$1"
  local detail="$2"
  printf '{"ok":false,"error":{"code":"%s","detail":"%s"}}\n' "$code" "$detail"
  printf '%s: %s\n' "$code" "$detail" >&2
  return 2
}

wiseeff_catalog_upgrade_tsx_source() {
  cat <<'TS'
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.WISEEFF_REPO_ROOT ?? "";
const modeArg = process.env.WISEEFF_CATALOG_APPLY_MODE ?? "";
const journalPath = process.env.WISEEFF_CATALOG_UPGRADE_JOURNAL ?? "";
const runId = process.env.WISEEFF_CATALOG_RUN_ID ?? "";
const graphPath = process.env.WISEEFF_CATALOG_GRAPH ?? "";
const releasePath = process.env.WISEEFF_CATALOG_RELEASE_JSON ?? "";
const databaseUrl = process.env.DATABASE_URL ?? "";
const targetArtifactSha = process.env.WISEEFF_CATALOG_TARGET_ARTIFACT_SHA ?? "";
const targetReleaseDigestArg = process.env.WISEEFF_CATALOG_TARGET_RELEASE_DIGEST ?? "";
const archiveRoot = process.env.WISEEFF_CATALOG_ARCHIVE_ROOT ?? "";
const archiveKeyHex = process.env.WISEEFF_CATALOG_ARCHIVE_KEY_HEX ?? "11".repeat(32);
const operatorAuditRef = process.env.WISEEFF_CATALOG_OPERATOR_AUDIT_REF ?? "audit-s11-apl-operator";
const quiescedAttestation = process.env.WISEEFF_CATALOG_QUIESCED === "true";
const deploymentId = process.env.WISEEFF_CATALOG_DEPLOYMENT_ID ?? "s11-apl";
const hostFingerprint = process.env.WISEEFF_CATALOG_HOST_FINGERPRINT ?? "sha256:s11-apl-host";

const spec = (rel: string): string => pathToFileURL(path.join(root, rel)).href;

const fail = (code: string, detail: string, exitCode = 2): never => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code, detail } })}\n`);
  process.stderr.write(`${code}: ${detail}\n`);
  process.exit(exitCode);
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const main = async () => {
  if (!root) {
    fail("PCAT-UPG-ILLEGAL-ACTION", "WISEEFF_REPO_ROOT is required");
  }
  const parsedMode = modeArg === "fresh" || modeArg === "populated" ? modeArg : null;
  if (!parsedMode) {
    fail("PCAT-UPG-ILLEGAL-ACTION", "apply mode must be exactly fresh XOR populated");
  }
  if (!quiescedAttestation) {
    fail(
      "PCAT-UPG-ILLEGAL-ACTION",
      "catalog apply requires operator attestation WISEEFF_CATALOG_QUIESCED=true; this is not P2 quiesce proof",
    );
  }
  if (!journalPath || !runId) {
    fail("PCAT-UPG-ILLEGAL-ACTION", "catalog apply requires --catalog-journal and --catalog-run-id");
  }
  if (!databaseUrl) {
    fail("PCAT-UPG-ILLEGAL-ACTION", "catalog apply requires DATABASE_URL");
  }
  if (!graphPath || !releasePath) {
    fail("PCAT-UPG-ILLEGAL-ACTION", "catalog apply requires --catalog-graph and --catalog-release-json");
  }
  if (!/^[0-9a-f]{40}$/.test(targetArtifactSha)) {
    fail("PCAT-UPG-ILLEGAL-ACTION", "catalog apply requires a 40-character lowercase git SHA");
  }

  const pg = createRequire(path.join(root, "package.json"))("pg") as typeof import("pg");
  const [
    controllerMod,
    actionsMod,
    journalMod,
    interfaceMod,
    orchestratorMod,
    classifierMod,
    archiveMod,
    kernelMod,
    compilerMod,
    verificationMod,
    postgresGatesMod,
    databaseMod,
    recoveryMod,
  ] = await Promise.all([
    import(spec("ops/self-hosted/scripts/parameter-catalog-upgrade/controller.ts")),
    import(spec("ops/self-hosted/scripts/parameter-catalog-upgrade/actions.ts")),
    import(spec("ops/self-hosted/scripts/parameter-catalog-upgrade/journal.ts")),
    import(spec("server/modules/catalog-cutover/interface.ts")),
    import(spec("server/modules/catalog-cutover/orchestrator.ts")),
    import(spec("server/modules/catalog-cutover/classifier/index.ts")),
    import(spec("server/modules/catalog-cutover/archive/index.ts")),
    import(spec("server/modules/catalog-kernel/interface.ts")),
    import(spec("server/modules/catalog-kernel/compiler/index.ts")),
    import(spec("server/modules/release-verification/core/index.ts")),
    import(spec("server/modules/release-verification/gates/postgres/index.ts")),
    import(spec("server/shared/database/client.ts")),
    import(spec("ops/self-hosted/storage/recoveryPoint.ts")),
  ]);

  const { openCatalogUpgradeController } = controllerMod;
  const { asPrepareVerificationCutover } = actionsMod;
  const { canonicalJson, sha256Prefixed } = journalMod;
  const { MIGRATION_CONTRACT_VERSION, PRE_ACTIVATION_PHASES, UNAVAILABLE_PHASES } = interfaceMod;
  const { planCutover, executeCutover, inspectCutover, recoverCutover } = orchestratorMod;
  const { fingerprintP0Graph } = classifierMod;
  const { createLocalArchiveObjectStore } = archiveMod;
  const { jsonCatalogReleaseSource } = kernelMod;
  const { compileCatalogRelease } = compilerMod;
  const { createReleaseVerificationService } = verificationMod;
  const { createPostgresGateAdapters, loadPackagedMigrationInventory } = postgresGatesMod;
  const { createDatabase } = databaseMod;
  const { createPostgresStorePort, isForbiddenComposeAppPostgres, postgresIdentityFromUrl } =
    recoveryMod;

  const allowComposeTest = process.env.WISEEFF_CATALOG_ALLOW_COMPOSE_TEST === "true";
  const composeAppTarget = isForbiddenComposeAppPostgres(databaseUrl);
  if (composeAppTarget && !allowComposeTest) {
    fail(
      "PCAT-UPG-API-MIGRATE-FORBIDDEN",
      "default compose 5432/wiseeff database is forbidden as a catalog apply target",
    );
  }

  mkdirSync(path.dirname(journalPath), { recursive: true, mode: 0o700 });
  const graph = JSON.parse(readFileSync(graphPath, "utf8"));
  const bundle = JSON.parse(readFileSync(releasePath, "utf8"));
  const catalogReleaseSource = jsonCatalogReleaseSource(bundle);
  const compiled = await compileCatalogRelease(bundle);
  if (!compiled.ok) {
    fail("PCAT-UPG-ILLEGAL-ACTION", compiled.error.kind);
  }
  const targetCatalogReleaseDigest = targetReleaseDigestArg || compiled.value.release.digest;
  if (compiled.value.release.digest !== targetCatalogReleaseDigest) {
    fail("PCAT-UPG-ILLEGAL-ACTION", "target catalog release digest does not match the compiled bundle");
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  const verifyClient = new pg.Client({ connectionString: databaseUrl });
  await verifyClient.connect();
  const db = createDatabase({
    query: async (text: string, values: unknown[] = []) => {
      const result = await verifyClient.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    },
  });

  type CutoverPlanLike = {
    planDigest: string;
    sourceSnapshotFingerprint: string;
    targetArtifactSha: string;
    targetCatalogReleaseDigest: string;
    migrationContractVersion: string;
    phases: readonly string[];
  };
  let lastPlan: CutoverPlanLike | null = null;
  let lastExecute: Record<string, unknown> | null = null;
  let lastAttempt: { results?: unknown } | null = null;

  const zeroInventoryPlan = (): CutoverPlanLike => {
    const sourceSnapshotFingerprint = fingerprintP0Graph(graph);
    return {
      planDigest: sha256Prefixed(
        canonicalJson({
          mode: "fresh",
          kind: "zero-inventory",
          sourceSnapshotFingerprint,
          targetArtifactSha,
          targetCatalogReleaseDigest,
          migrationContractVersion: MIGRATION_CONTRACT_VERSION,
          contractPhases: PRE_ACTIVATION_PHASES,
        }),
      ),
      sourceSnapshotFingerprint,
      targetArtifactSha,
      targetCatalogReleaseDigest,
      migrationContractVersion: MIGRATION_CONTRACT_VERSION,
      phases: PRE_ACTIVATION_PHASES,
    };
  };

  const zeroInventorySnapshot = (plan: { planDigest: string }) => {
    const committedAt = new Date().toISOString();
    const payload = {
      kind: "zero-inventory",
      mode: "fresh",
      identityCount: 0,
      specCount: 0,
      liveRun: false,
      executedPhases: [] as const,
    };
    return {
      runId: `cutover_zero_${runId}`,
      planDigest: plan.planDigest,
      currentPhase: "P0",
      state: "completed",
      resumed: false,
      liveRun: false,
      checkpoints: [
        {
          phase: "P0",
          checkpointDigest: sha256Prefixed(canonicalJson(payload)),
          payload,
          committedAt,
        },
      ],
      runBoundToken: null,
      recoveryPointDump: null,
    };
  };

  const checkpointDigestOf = (snapshot: Record<string, unknown> | null, phase: string): string => {
    const checkpoints = snapshot?.checkpoints;
    if (!Array.isArray(checkpoints)) {
      return "";
    }
    for (const row of checkpoints) {
      const record = asRecord(row);
      if (record?.phase === phase && typeof record.checkpointDigest === "string") {
        return record.checkpointDigest;
      }
    }
    return "";
  };

  const summarizeGates = (results: unknown) => {
    const gates = Array.isArray(results)
      ? results.map((row) => {
          const record = asRecord(row) ?? {};
          return {
            gateId: String(record.gateId ?? ""),
            status: String(record.status ?? ""),
            failureCode: record.failureCode ?? null,
            successorPurpose: record.successorPurpose ?? null,
          };
        })
      : [];
    const ids = (status: string) =>
      gates.filter((gate) => gate.status === status).map((gate) => gate.gateId);
    const requiredNow = gates.filter(
      (gate) => gate.status !== "not-yet-executable" && gate.status !== "not-applicable",
    );
    return {
      gates,
      passedGateIds: ids("passed"),
      failedGateIds: ids("failed"),
      notYetExecutableGateIds: ids("not-yet-executable"),
      notApplicableGateIds: ids("not-applicable"),
      allRequiredNowPassed: requiredNow.length > 0 && requiredNow.every((gate) => gate.status === "passed"),
      claimedFullV01V17: false,
    };
  };

  try {
    const inventory = await pool.query<{ identities: string; specs: string }>(
      `
      select
        (select count(*)::text from parameter_catalog.legacy_identities) as identities,
        (select count(*)::text from public.parameter_specs) as specs
      `,
    );
    const identityCount = Number(inventory.rows[0]?.identities ?? 0);
    const specCount = Number(inventory.rows[0]?.specs ?? 0);
    const graphIdentities = Array.isArray(graph.identities) ? graph.identities.length : 0;
    if (parsedMode === "fresh" && (identityCount > 0 || specCount > 0 || graphIdentities > 0)) {
      fail("PCAT-UPG-ILLEGAL-ACTION", "fresh apply requires empty inventory and an empty P0 graph");
    }

    const archiveObjectStore = createLocalArchiveObjectStore(
      archiveRoot || path.join(path.dirname(journalPath), "archive"),
    );
    const archiveEncryptionKey = Buffer.from(archiveKeyHex, "hex");
    const postgresIdentity = postgresIdentityFromUrl(databaseUrl);
    const postgresPort = createPostgresStorePort(databaseUrl, {
      allowComposeApp: allowComposeTest && composeAppTarget,
    });
    const postgresSnapshot = await postgresPort.snapshot(new Date());
    if (!postgresSnapshot) {
      fail("PCAT-UPG-ILLEGAL-ACTION", "postgres recovery snapshot was not captured");
    }
    const postgresRecoveryDigest = postgresSnapshot.checksum;
    const postgresRecoveryId = `pg-only-${runId}`;

    const cutover = {
      plan: async (input: never) => {
        const planned = await planCutover({ ...(input as object), catalogReleaseSource, graph });
        if (parsedMode === "populated") {
          if (planned.ok) lastPlan = planned.value;
          return planned;
        }
        if (planned.ok) {
          return {
            ok: false,
            error: {
              code: "PCAT-ORC-INVALID-PLAN",
              detail: "fresh apply refuses a populated P0 graph",
            },
          };
        }
        if (planned.error.code !== "PCAT-ORC-NOT-POPULATED") {
          return planned;
        }
        lastPlan = zeroInventoryPlan();
        return { ok: true, value: lastPlan };
      },
      execute: async (input: { plan: CutoverPlanLike }) => {
        const executed = await executeCutover({
          pool,
          plan: input.plan,
          graph,
          catalogReleaseSource,
          archiveObjectStore,
          archiveEncryptionKey,
          operatorAuditRef,
        });
        if (parsedMode === "populated") {
          if (executed.ok) lastExecute = executed.value as Record<string, unknown>;
          return executed;
        }
        if (executed.ok) {
          return {
            ok: false,
            error: {
              code: "PCAT-ORC-INVALID-PLAN",
              detail: "fresh apply refuses populated P0-P10 evidence",
            },
          };
        }
        if (executed.error.code !== "PCAT-ORC-NOT-POPULATED") {
          return executed;
        }
        lastExecute = zeroInventorySnapshot(input.plan) as Record<string, unknown>;
        return { ok: true, value: lastExecute };
      },
      inspect: async (input: never) => inspectCutover({ ...(input as object), pool }),
      recover: async (input: never) => recoverCutover({ ...(input as object), pool }),
    };

    const service = createReleaseVerificationService({
      db,
      adapters: createPostgresGateAdapters({ db }),
    });
    const verification = {
      prepareVerification: service.prepareVerification.bind(service),
      runVerification: async (planDigest: string) => {
        const ran = await service.runVerification(planDigest);
        if (ran.ok) {
          lastAttempt = ran.value as { results?: unknown };
        }
        return ran;
      },
    };

    const opened = openCatalogUpgradeController({
      journalPath,
      runId,
      cutover,
      verification,
    });
    if (!opened.ok) {
      fail(opened.error.code, opened.error.detail);
    }
    const controller = opened.value;
    const planned = await controller.dispatch({
      action: "plan",
      input: { graph, targetArtifactSha, targetCatalogReleaseDigest },
    });
    if (!planned.ok) {
      fail(planned.error.code, planned.error.detail);
    }

    const planForExecute = lastPlan ?? {
      planDigest: planned.value.planDigest,
      sourceSnapshotFingerprint: fingerprintP0Graph(graph),
      targetArtifactSha,
      targetCatalogReleaseDigest,
      migrationContractVersion: MIGRATION_CONTRACT_VERSION,
      phases: PRE_ACTIVATION_PHASES,
    };

    const executed = await controller.dispatch({
      action: "execute",
      input: { plan: planForExecute },
    });
    if (!executed.ok) {
      fail(executed.error.code, executed.error.detail);
    }

    const inventoryDigest = await loadPackagedMigrationInventory();
    const populatedPins = parsedMode === "populated";
    const mappingHeadDigest = populatedPins ? checkpointDigestOf(lastExecute, "P7") : "";
    const archiveManifestDigest = populatedPins ? checkpointDigestOf(lastExecute, "P10") : "";
    const mappingEpoch = populatedPins
      ? String(lastExecute?.runId ?? planForExecute.planDigest)
      : "";
    const phaseSnapshot = populatedPins ? "P10" : "zero-inventory";

    const prepareInput = {
      subject: {
        targetId: deploymentId,
        deploymentClass: "self-hosted",
        environmentId: "env-isolated",
      },
      purpose: "pre-activation",
      mode: parsedMode,
      lineage: {
        phaseSnapshot,
        predecessorReportDigests: [],
        p12State: "not-started",
        p13State: "not-started",
        writerRetirementFingerprint: null,
        runtimePinGeneration: null,
        pointerRollbackStatus: "open",
        trafficIsolationState: "isolated",
      },
      pins: {
        artifact: {
          gitSha: targetArtifactSha,
          releaseTag: "v-s11-apl",
          packageManifestDigest: "",
          apiImageDigest: "",
          workerImageDigest: "",
          webImageDigest: "",
        },
        catalog: {
          releaseId: compiled.value.release.id,
          releaseDigest: compiled.value.release.digest,
          compiledModelDigest: compiled.value.compiledReleaseDigest,
          materializationFingerprint: compiled.value.materializationFingerprint,
        },
        database: {
          targetIdentity: postgresIdentity,
          schemaVersion: inventoryDigest.schemaVersionPrefix,
          migrationInventoryDigest: inventoryDigest.digest,
        },
        cutover: asPrepareVerificationCutover(planForExecute),
        mappingArchive: {
          mappingEpoch,
          mappingHeadDigest,
          archiveManifestDigest,
        },
        recovery: {
          recoveryPointId: postgresRecoveryId,
          recoveryPointDigest: postgresRecoveryDigest,
        },
        acceptance: {
          openApiDigest: "",
          browserBundleSha: "",
        },
        target: {
          deploymentId,
          hostFingerprint,
        },
        verification: {
          contractVersion: "s10-per",
          verifierRole: "catalog_verifier",
        },
      },
      evidenceRequirements: {
        recoveryPointDigest: postgresRecoveryDigest,
        mappingEpoch: mappingEpoch,
        cutoverPlanDigest: planForExecute.planDigest,
        acceptanceContractDigest: "",
      },
    };

    const prepared = await controller.dispatch({
      action: "prepareVerification",
      input: prepareInput,
    });
    if (!prepared.ok) {
      fail(prepared.error.code, prepared.error.detail);
    }
    const ran = await controller.dispatch({
      action: "runVerification",
      input: { planDigest: prepared.value.verificationPlanDigest },
    });
    if (!ran.ok) {
      fail(ran.error.code, ran.error.detail);
    }

    const replayed = Boolean(
      planned.value.replayed &&
        executed.value.replayed &&
        prepared.value.replayed &&
        ran.value.replayed,
    );
    const gateSummary = summarizeGates(lastAttempt?.results);
    const zeroMode = parsedMode === "fresh";
    const cutoverOut = lastExecute ?? {
      planDigest: ran.value.planDigest,
      runId: ran.value.cutoverRunId,
      currentPhase: zeroMode ? "P0" : "P10",
      state: "completed",
      liveRun: false,
      identityCount: zeroMode ? 0 : undefined,
    };
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        applyCompleted: true,
        mode: parsedMode,
        replayed,
        state: ran.value.state,
        zeroMode,
        contractPhases: PRE_ACTIVATION_PHASES,
        executedPhases: zeroMode ? [] : PRE_ACTIVATION_PHASES,
        verificationPhase: "P11a",
        isolation: "isolated",
        p12State: "not-started",
        p13State: "not-started",
        quiesceAttestation: "WISEEFF_CATALOG_QUIESCED",
        journal: ran.value,
        verification: {
          mode: parsedMode,
          purpose: "pre-activation",
          planDigest: ran.value.verificationPlanDigest,
          attemptDigest: ran.value.verificationAttemptDigest,
          isolation: "isolated",
          ...gateSummary,
        },
        recoveryPoint: {
          threeStoreRecoveryPoint: false,
          capturedStores: ["postgres"],
          notCapturedStores: ["object-store", "redis"],
          postgres: {
            identity: postgresSnapshot.identity,
            checksum: postgresSnapshot.checksum,
          },
          recoveryPointId: postgresRecoveryId,
          recoveryPointDigest: postgresRecoveryDigest,
        },
        cutover: {
          ...cutoverOut,
          zeroMode,
          identityCount: zeroMode ? 0 : cutoverOut.identityCount,
          liveRun: cutoverOut.liveRun === true,
        },
        unavailablePhases: UNAVAILABLE_PHASES,
      })}\n`,
    );
  } finally {
    await pool.end().catch(() => undefined);
    await verifyClient.end().catch(() => undefined);
  }
};

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stdout.write(
    `${JSON.stringify({ ok: false, error: { code: "PCAT-UPG-ILLEGAL-ACTION", detail } })}\n`,
  );
  process.stderr.write(`PCAT-UPG-ILLEGAL-ACTION: ${detail}\n`);
  process.exit(1);
});
TS
}

wiseeff_catalog_upgrade_apply() {
  local mode="$1"
  local journal_path="$2"
  local run_id="$3"
  local graph_path="$4"
  local release_path="$5"
  local artifact_sha="$6"
  local release_digest="$7"
  local archive_root="$8"
  local archive_key="$9"
  local operator_ref="${10}"
  local compose_dir repo_root tsx runner status
  compose_dir="$(cd "${script_dir}/.." && pwd)"
  repo_root="$(cd "${compose_dir}/../.." && pwd)"
  tsx="${repo_root}/node_modules/.bin/tsx"
  if [ ! -x "$tsx" ]; then
    wiseeff_catalog_upgrade_refuse "PCAT-UPG-ILLEGAL-ACTION" "catalog apply requires repo node_modules/.bin/tsx" || return $?
  fi
  if [ -z "$journal_path" ]; then
    journal_path="${WISEEFF_UPGRADE_STATE_DIR:-${repo_root}/ops/self-hosted/.state/upgrades}/catalog/${run_id}/journal.json"
  fi
  mkdir -p "$(dirname "$journal_path")"
  runner="$(mktemp "${TMPDIR:-/tmp}/wiseeff-catalog-apply.XXXXXX")"
  mv "$runner" "${runner}.mts"
  runner="${runner}.mts"
  wiseeff_catalog_upgrade_tsx_source > "$runner"
  (
    cd "$repo_root" || exit 1
    NODE_PATH="${repo_root}/node_modules" \
      WISEEFF_REPO_ROOT="$repo_root" \
      WISEEFF_CATALOG_APPLY_MODE="$mode" \
      WISEEFF_CATALOG_UPGRADE_JOURNAL="$journal_path" \
      WISEEFF_CATALOG_RUN_ID="$run_id" \
      WISEEFF_CATALOG_GRAPH="$graph_path" \
      WISEEFF_CATALOG_RELEASE_JSON="$release_path" \
      WISEEFF_CATALOG_TARGET_ARTIFACT_SHA="$artifact_sha" \
      WISEEFF_CATALOG_TARGET_RELEASE_DIGEST="$release_digest" \
      WISEEFF_CATALOG_ARCHIVE_ROOT="$archive_root" \
      WISEEFF_CATALOG_ARCHIVE_KEY_HEX="$archive_key" \
      WISEEFF_CATALOG_OPERATOR_AUDIT_REF="$operator_ref" \
      "$tsx" "$runner"
  ) && status=0 || status=$?
  rm -f "$runner"
  return "$status"
}

wiseeff_upgrade_main() {
  local catalog_intent="false"
  local catalog_journal="${WISEEFF_CATALOG_UPGRADE_JOURNAL:-}"
  local catalog_graph=""
  local catalog_release_json=""
  local catalog_run_id=""
  local catalog_artifact_sha=""
  local catalog_release_digest=""
  local catalog_archive_root=""
  local catalog_archive_key=""
  local catalog_operator_ref=""
  local catalog_illegal_action=""
  local -a catalog_modes=()
  local protocol_file="${script_dir}/../upgrade-protocol.env"
  local proto_mode=""
  local proto_journal=""
  local args=("$@")
  local i=0
  local arg=""
  local forbidden=""
  local gate_control=""
  local guess=""

  if [ -f "$protocol_file" ]; then
    proto_mode="$(awk -F= '$1 == "WISEEFF_CATALOG_APPLY_MODE" { print substr($0, index($0, "=") + 1); exit }' "$protocol_file")"
    proto_journal="$(awk -F= '$1 == "WISEEFF_CATALOG_UPGRADE_JOURNAL" { print substr($0, index($0, "=") + 1); exit }' "$protocol_file")"
  fi
  if [ -n "$proto_mode" ]; then
    catalog_intent="true"
    catalog_modes+=("$proto_mode")
  fi
  if [ -z "$catalog_journal" ] && [ -n "$proto_journal" ]; then
    catalog_journal="$proto_journal"
  fi
  if [ -n "${WISEEFF_CATALOG_APPLY_MODE:-}" ]; then
    catalog_intent="true"
    catalog_modes+=("${WISEEFF_CATALOG_APPLY_MODE}")
  fi

  while [ "$i" -lt "${#args[@]}" ]; do
    arg="${args[$i]}"
    case "$arg" in
      catalog-apply)
        catalog_intent="true"
        ;;
      --catalog-apply)
        catalog_intent="true"
        ;;
      --catalog-apply-mode)
        catalog_intent="true"
        i=$((i + 1))
        if [ "$i" -ge "${#args[@]}" ]; then
          wiseeff_catalog_upgrade_refuse "PCAT-UPG-ILLEGAL-ACTION" "--catalog-apply-mode requires a value" || return $?
        fi
        catalog_modes+=("${args[$i]}")
        ;;
      --catalog-journal)
        catalog_intent="true"
        i=$((i + 1))
        [ "$i" -lt "${#args[@]}" ] || { wiseeff_catalog_upgrade_refuse "PCAT-UPG-ILLEGAL-ACTION" "--catalog-journal requires a value" || return $?; }
        catalog_journal="${args[$i]}"
        ;;
      --catalog-graph)
        catalog_intent="true"
        i=$((i + 1))
        [ "$i" -lt "${#args[@]}" ] || { wiseeff_catalog_upgrade_refuse "PCAT-UPG-ILLEGAL-ACTION" "--catalog-graph requires a value" || return $?; }
        catalog_graph="${args[$i]}"
        ;;
      --catalog-release-json)
        catalog_intent="true"
        i=$((i + 1))
        [ "$i" -lt "${#args[@]}" ] || { wiseeff_catalog_upgrade_refuse "PCAT-UPG-ILLEGAL-ACTION" "--catalog-release-json requires a value" || return $?; }
        catalog_release_json="${args[$i]}"
        ;;
      --catalog-run-id)
        catalog_intent="true"
        i=$((i + 1))
        [ "$i" -lt "${#args[@]}" ] || { wiseeff_catalog_upgrade_refuse "PCAT-UPG-ILLEGAL-ACTION" "--catalog-run-id requires a value" || return $?; }
        catalog_run_id="${args[$i]}"
        ;;
      --catalog-target-artifact-sha)
        i=$((i + 1))
        [ "$i" -lt "${#args[@]}" ] || { wiseeff_catalog_upgrade_refuse "PCAT-UPG-ILLEGAL-ACTION" "--catalog-target-artifact-sha requires a value" || return $?; }
        catalog_artifact_sha="${args[$i]}"
        ;;
      --catalog-target-release-digest)
        i=$((i + 1))
        [ "$i" -lt "${#args[@]}" ] || { wiseeff_catalog_upgrade_refuse "PCAT-UPG-ILLEGAL-ACTION" "--catalog-target-release-digest requires a value" || return $?; }
        catalog_release_digest="${args[$i]}"
        ;;
      --catalog-archive-root)
        i=$((i + 1))
        [ "$i" -lt "${#args[@]}" ] || { wiseeff_catalog_upgrade_refuse "PCAT-UPG-ILLEGAL-ACTION" "--catalog-archive-root requires a value" || return $?; }
        catalog_archive_root="${args[$i]}"
        ;;
      --catalog-archive-key-hex)
        i=$((i + 1))
        [ "$i" -lt "${#args[@]}" ] || { wiseeff_catalog_upgrade_refuse "PCAT-UPG-ILLEGAL-ACTION" "--catalog-archive-key-hex requires a value" || return $?; }
        catalog_archive_key="${args[$i]}"
        ;;
      --catalog-operator-audit-ref)
        i=$((i + 1))
        [ "$i" -lt "${#args[@]}" ] || { wiseeff_catalog_upgrade_refuse "PCAT-UPG-ILLEGAL-ACTION" "--catalog-operator-audit-ref requires a value" || return $?; }
        catalog_operator_ref="${args[$i]}"
        ;;
      --catalog-action)
        catalog_intent="true"
        catalog_illegal_action="--catalog-action"
        i=$((i + 1))
        ;;
      --run-id)
        i=$((i + 1))
        if [ "$i" -lt "${#args[@]}" ] && [ -z "$catalog_run_id" ]; then
          catalog_run_id="${args[$i]}"
        fi
        ;;
      --migrate-via-api|--api-migration|--migrate-through-api|--startup-migrate|--startup-migration)
        forbidden="api-migrate"
        ;;
      --gates|--gate-ids|--gate-list|--gate-selection|--waiver|--waive|--waived)
        gate_control="true"
        i=$((i + 1))
        ;;
      --guessed-commit|--guessed-outcome)
        guess="true"
        ;;
      --skip)
        gate_control="true"
        i=$((i + 1))
        ;;
      inspect|recover|resume)
        catalog_illegal_action="$arg"
        ;;
      P11|P12|P13|P14|P15|P16|activate-p12|retire-p13|public-release)
        catalog_intent="true"
        catalog_illegal_action="$arg"
        ;;
      selectGates)
        catalog_intent="true"
        gate_control="true"
        ;;
      migrateViaApi)
        catalog_intent="true"
        forbidden="api-migrate"
        ;;
      guessUnknownCommit)
        catalog_intent="true"
        guess="true"
        ;;
    esac
    i=$((i + 1))
  done

  if [ -n "${WISEEFF_MIGRATE_VIA_API:-}" ] || [ -n "${WISEEFF_STARTUP_MIGRATION:-}" ]; then
    forbidden="api-migrate"
  fi

  if [ "$forbidden" = "api-migrate" ]; then
    wiseeff_catalog_upgrade_refuse "PCAT-UPG-API-MIGRATE-FORBIDDEN" "API startup migration is not a controller action" || return $?
  fi
  if [ "$gate_control" = "true" ]; then
    wiseeff_catalog_upgrade_refuse "PCAT-UPG-GATE-SELECTION-FORBIDDEN" "caller supplied gate selection" || return $?
  fi
  if [ "$guess" = "true" ]; then
    wiseeff_catalog_upgrade_refuse "PCAT-UPG-UNKNOWN-OUTCOME" "Unknown commit outcome cannot be guessed" || return $?
  fi

  if [ "$catalog_intent" != "true" ]; then
    wiseeff_upgrade_stack_main "$@"
    return $?
  fi

  if [ -n "$catalog_illegal_action" ]; then
    wiseeff_catalog_upgrade_refuse "PCAT-UPG-ILLEGAL-ACTION" "catalog apply is one-shot apply only; ${catalog_illegal_action} is not a catalog apply action (UNAVAILABLE_PHASES / S11-REC)" || return $?
  fi

  local resolved=""
  local candidate=""
  if [ "${#catalog_modes[@]}" -eq 0 ]; then
    wiseeff_catalog_upgrade_refuse "PCAT-UPG-ILLEGAL-ACTION" "apply mode must be exactly fresh XOR populated" || return $?
  fi
  for candidate in "${catalog_modes[@]}"; do
    if [ "$candidate" != "fresh" ] && [ "$candidate" != "populated" ]; then
      wiseeff_catalog_upgrade_refuse "PCAT-UPG-ILLEGAL-ACTION" "apply mode must be exactly fresh XOR populated" || return $?
    fi
    if [ -z "$resolved" ]; then
      resolved="$candidate"
    elif [ "$resolved" != "$candidate" ]; then
      wiseeff_catalog_upgrade_refuse "PCAT-UPG-ILLEGAL-ACTION" "apply mode must be exactly fresh XOR populated" || return $?
    fi
  done
  if [ -z "$resolved" ]; then
    wiseeff_catalog_upgrade_refuse "PCAT-UPG-ILLEGAL-ACTION" "apply mode must be exactly fresh XOR populated" || return $?
  fi

  if [ "${WISEEFF_CATALOG_QUIESCED:-}" != "true" ]; then
    wiseeff_catalog_upgrade_refuse "PCAT-UPG-ILLEGAL-ACTION" "catalog apply requires operator attestation WISEEFF_CATALOG_QUIESCED=true; this is not P2 quiesce proof" || return $?
  fi

  if [ "${WISEEFF_CATALOG_ALLOW_COMPOSE_TEST:-}" != "true" ]; then
    case "${DATABASE_URL:-}" in
      *127.0.0.1:5432/wiseeff*|*localhost:5432/wiseeff*|*@127.0.0.1/wiseeff*|*@localhost/wiseeff*)
        wiseeff_catalog_upgrade_refuse "PCAT-UPG-API-MIGRATE-FORBIDDEN" "default compose 5432/wiseeff database is forbidden as a catalog apply target" || return $?
        ;;
    esac
  fi

  if [ -z "$catalog_run_id" ]; then
    catalog_run_id="capply-$(date -u +%Y%m%dT%H%M%SZ)"
  fi

  wiseeff_catalog_upgrade_apply \
    "$resolved" \
    "$catalog_journal" \
    "$catalog_run_id" \
    "$catalog_graph" \
    "$catalog_release_json" \
    "$catalog_artifact_sha" \
    "$catalog_release_digest" \
    "$catalog_archive_root" \
    "$catalog_archive_key" \
    "$catalog_operator_ref"
}

wiseeff_upgrade_main "$@"
