#!/usr/bin/env bash
# Read-only collection of Catalog publication facts on a self-hosted host.
# Does not adopt, enable, freeze, grant, restart, or print DSNs/passwords.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  cd /srv/wiseeff/ops/self-hosted
  ./scripts/collect-catalog-publication-status.sh [options]

Read-only. Uses ./scripts/compose and the running application image.
Does not require host npx, tsx, or psql. Does not write Catalog, policy, or freeze.

Options:
  --out PATH                 Write JSON report (mode 0600). Default: ./catalog-publication-status.json
  --readonly-dsn-file PATH   File whose only content is the inspect LOGIN URL (not printed)
  --bundle PATH              Existing Catalog bundle JSON; runs adopt --check only
  --verification-digest DIG  Required with --bundle (sha256:...)
  --data-mode MODE           fresh|populated|restored (default: populated)
  --actor ID                 Actor recorded for adopt --check (default: WISEEFF_UPGRADE_ACTOR_PRINCIPAL_ID or unknown)
  --user-id ID               With --organization-id, collect capability status
  --organization-id ID       With --user-id, collect capability status
  --help

Exit:
  0 collection finished (individual probes may be failed inside JSON)
  2 usage / missing compose / missing .env / missing python3
EOF
}

need_value() {
  if [ "$#" -lt 2 ] || [ -z "${2:-}" ] || [ "${2#--}" != "$2" ]; then
    printf '%s\n' "missing value for $1" >&2
    usage >&2
    exit 2
  fi
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_dir="$(cd "${WISEEFF_COLLECT_COMPOSE_DIR:-${script_dir}/..}" && pwd)"
repo_root="$(cd "${WISEEFF_COLLECT_REPO_ROOT:-${compose_dir}/../..}" && pwd)"
compose="${WISEEFF_COLLECT_COMPOSE:-${script_dir}/compose}"
env_file="${compose_dir}/.env"
manager_env="${compose_dir}/.env.publication-manager"

out_path="${compose_dir}/catalog-publication-status.json"
readonly_dsn_file=""
bundle_path=""
verification_digest=""
data_mode="populated"
actor=""
user_id=""
organization_id=""

while [ $# -gt 0 ]; do
  case "$1" in
    --help | -h)
      usage
      exit 0
      ;;
    --out)
      need_value "$@"
      out_path="$2"
      shift 2
      ;;
    --readonly-dsn-file)
      need_value "$@"
      readonly_dsn_file="$2"
      shift 2
      ;;
    --bundle)
      need_value "$@"
      bundle_path="$2"
      shift 2
      ;;
    --verification-digest)
      need_value "$@"
      verification_digest="$2"
      shift 2
      ;;
    --data-mode)
      need_value "$@"
      data_mode="$2"
      shift 2
      ;;
    --actor)
      need_value "$@"
      actor="$2"
      shift 2
      ;;
    --user-id)
      need_value "$@"
      user_id="$2"
      shift 2
      ;;
    --organization-id)
      need_value "$@"
      organization_id="$2"
      shift 2
      ;;
    *)
      printf '%s\n' "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -n "$bundle_path" ] && [ -z "$verification_digest" ]; then
  printf '%s\n' "--bundle requires --verification-digest sha256:..." >&2
  exit 2
fi
if [ -n "$verification_digest" ] && [ -z "$bundle_path" ]; then
  printf '%s\n' "--verification-digest requires --bundle" >&2
  exit 2
fi
if [ -n "$user_id" ] && [ -z "$organization_id" ]; then
  printf '%s\n' "--user-id requires --organization-id" >&2
  exit 2
fi
if [ -n "$organization_id" ] && [ -z "$user_id" ]; then
  printf '%s\n' "--organization-id requires --user-id" >&2
  exit 2
fi
if [ "$data_mode" != "fresh" ] && [ "$data_mode" != "populated" ] && [ "$data_mode" != "restored" ]; then
  printf '%s\n' "--data-mode must be fresh, populated, or restored" >&2
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' "python3 is required to merge the JSON report" >&2
  exit 2
fi
if [ ! -x "$compose" ] || [ ! -f "$env_file" ]; then
  printf '%s\n' "run from a self-hosted checkout: cd /srv/wiseeff/ops/self-hosted" >&2
  exit 2
fi

redact() {
  sed -E \
    -e 's#postgres(ql)?://[^[:space:]"'\'']+#postgres://[redacted]#g' \
    -e 's#(DATABASE_URL|WISEEFF_[A-Z0-9_]*DATABASE_URL|CATALOG_BASELINE_READONLY_DATABASE_URL|WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL)[=:][^[:space:]"'\'']+#\1=[redacted]#g' \
    -e 's#("password"|"secret"|"token"|"dsn"|"connectionString")[[:space:]]*:[[:space:]]*"[^"]*"#\1:"[redacted]"#g' \
    -e 's#(password|PASSWORD|secret|SECRET|token|TOKEN|dsn|DSN)[=:][^[:space:]"'\'']+#\1=[redacted]#g'
}

read_env_key() {
  local file="$1" key="$2" line="" value=""
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      \#* | "")
        continue
        ;;
      "export ${key}="*)
        value="${line#export ${key}=}"
        ;;
      "${key}="*)
        value="${line#${key}=}"
        ;;
      *)
        continue
        ;;
    esac
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    printf '%s\n' "$value"
    return 0
  done <"$file"
}

strip_url() {
  local value="${1:-}"
  value="${value%"${value##*[![:space:]]}"}"
  value="${value#"${value%%[![:space:]]*}"}"
  printf '%s\n' "$value"
}

manager_dsn_configured="false"
manager_url=""
if [ -f "$manager_env" ]; then
  manager_url="$(strip_url "$(read_env_key "$manager_env" WISEEFF_PUBLICATION_MANAGER_DATABASE_URL || true)")"
  if [ -n "$manager_url" ]; then
    manager_dsn_configured="true"
  fi
fi
if [ -z "$actor" ]; then
  actor="$(strip_url "$(read_env_key "$manager_env" WISEEFF_UPGRADE_ACTOR_PRINCIPAL_ID || true)")"
  actor="${actor:-unknown}"
fi

readonly_url=""
if [ -n "$readonly_dsn_file" ]; then
  if [ ! -f "$readonly_dsn_file" ]; then
    printf '%s\n' "--readonly-dsn-file not found" >&2
    exit 2
  fi
  readonly_url="$(tr -d '\r\n' <"$readonly_dsn_file")"
  case "$readonly_url" in
    CATALOG_BASELINE_READONLY_DATABASE_URL=*)
      readonly_url="${readonly_url#CATALOG_BASELINE_READONLY_DATABASE_URL=}"
      readonly_url="${readonly_url%\"}"
      readonly_url="${readonly_url#\"}"
      ;;
  esac
  readonly_url="$(strip_url "$readonly_url")"
  if [ -z "$readonly_url" ]; then
    printf '%s\n' "--readonly-dsn-file is empty" >&2
    exit 2
  fi
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/wiseeff-catalog-status.XXXXXX")"
cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT
chmod 700 "$work"

probe() {
  local name="$1"
  shift
  local out="${work}/${name}.out"
  local err="${work}/${name}.err"
  local code=0
  set +e
  "$@" >"$out" 2>"$err"
  code=$?
  set -e
  redact <"$out" >"${work}/${name}.stdout"
  redact <"$err" >"${work}/${name}.stderr"
  printf '%s\n' "$code" >"${work}/${name}.code"
}

compose_cmd() {
  "$compose" --env-file "$env_file" "$@"
}

# Image-identity ops: never exec the live API process (WISEEFF_API_PROCESS=1).
# Export values, then pass -e NAME so DSNs never appear on argv.
# Matches ops/self-hosted/scripts/upgrade-lib.sh wiseeff_upgrade_publication_ops.
export WISEEFF_API_PROCESS=0
export LOG_WORKER_ENABLED=false
export WISEEFF_PUBLICATION_MANAGER=1

ops_in_image() {
  local -a run_opts
  run_opts=(
    run --rm --no-deps
    -e WISEEFF_API_PROCESS
    -e LOG_WORKER_ENABLED
    -e WISEEFF_PUBLICATION_MANAGER
  )
  while [ $# -gt 0 ]; do
    case "$1" in
      -v)
        run_opts+=(-v "$2")
        shift 2
        ;;
      --)
        shift
        break
        ;;
      *)
        break
        ;;
    esac
  done
  if [ -n "${DATABASE_URL:-}" ]; then
    run_opts+=(-e DATABASE_URL)
  fi
  if [ -n "${WISEEFF_WORKER_DATABASE_URL:-}" ]; then
    run_opts+=(-e WISEEFF_WORKER_DATABASE_URL)
  fi
  if [ -n "${WISEEFF_PUBLICATION_MANAGER_DATABASE_URL:-}" ]; then
    run_opts+=(-e WISEEFF_PUBLICATION_MANAGER_DATABASE_URL)
  fi
  if [ -n "${CATALOG_BASELINE_READONLY_DATABASE_URL:-}" ]; then
    run_opts+=(-e CATALOG_BASELINE_READONLY_DATABASE_URL)
  fi
  if [ -n "${WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL:-}" ]; then
    run_opts+=(-e WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL)
  fi
  compose_cmd "${run_opts[@]}" api npx tsx scripts/catalog-publication-ops.ts "$@"
}

export DATABASE_URL="$(strip_url "$(read_env_key "$env_file" DATABASE_URL || true)")"
export WISEEFF_WORKER_DATABASE_URL="$(strip_url "$(read_env_key "$env_file" WISEEFF_WORKER_DATABASE_URL || true)")"
if [ "$manager_dsn_configured" = "true" ]; then
  export WISEEFF_PUBLICATION_MANAGER_DATABASE_URL="$manager_url"
fi
bootstrap_url="$(strip_url "$(read_env_key "$manager_env" WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL || true)")"
if [ -z "$bootstrap_url" ]; then
  bootstrap_url="$(strip_url "$(read_env_key "$env_file" WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL || true)")"
fi
if [ -n "$bootstrap_url" ]; then
  export WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL="$bootstrap_url"
fi
if [ -n "$readonly_url" ]; then
  if [ -n "${DATABASE_URL:-}" ] && [ "$readonly_url" = "$DATABASE_URL" ]; then
    printf '%s\n' "inspect LOGIN must not reuse DATABASE_URL" >&2
    exit 2
  fi
  export CATALOG_BASELINE_READONLY_DATABASE_URL="$readonly_url"
fi

cd "$compose_dir"

probe collected_at date -u +%Y-%m-%dT%H:%M:%SZ
probe hostname hostname
probe uname uname -a
probe git_head git -C "$repo_root" rev-parse HEAD
probe git_status git -C "$repo_root" status -sb --untracked-files=no
probe git_log git -C "$repo_root" log -1 --format='%H %s'
probe compose_ps compose_cmd ps -a
probe compose_images compose_cmd images
probe api_live compose_cmd exec -T api curl -fsS http://127.0.0.1:8787/health/live
probe api_ready compose_cmd exec -T api curl -fsS http://127.0.0.1:8787/health/ready
probe api_process_flag compose_cmd exec -T api printenv WISEEFF_API_PROCESS
probe manager_live compose_cmd exec -T publication-manager curl -fsS http://127.0.0.1:8791/health/live
probe manager_flag compose_cmd exec -T publication-manager printenv WISEEFF_PUBLICATION_MANAGER
probe worker_live compose_cmd exec -T worker curl -fsS http://127.0.0.1:8788/health/live
probe ops_cli_present compose_cmd run --rm --no-deps api test -f scripts/catalog-publication-ops.ts

if [ -n "${DATABASE_URL:-}" ]; then
  probe inspect_login_api ops_in_image inspect-login api
fi
if [ -n "${WISEEFF_WORKER_DATABASE_URL:-}" ]; then
  probe inspect_login_worker ops_in_image inspect-login worker
fi
if [ "$manager_dsn_configured" = "true" ]; then
  probe inspect_login_manager ops_in_image inspect-login manager
  probe policy_status ops_in_image policy status
  probe freeze_status ops_in_image freeze status
fi
if [ -n "${CATALOG_BASELINE_READONLY_DATABASE_URL:-}" ]; then
  probe inspect_catalog ops_in_image inspect
fi

if [ -n "$bundle_path" ] && [ "$manager_dsn_configured" = "true" ]; then
  if [ ! -f "$bundle_path" ]; then
    printf '%s\n' "--bundle not found" >&2
    exit 2
  fi
  policy_stdout="${work}/policy_status.stdout"
  expected_id=""
  expected_digest=""
  if [ -f "$policy_stdout" ]; then
    expected_id="$(python3 -c 'import json,sys
try:
  d=json.loads(sys.stdin.read())
except Exception:
  d={}
print(d.get("currentReleaseId") or "")' <"$policy_stdout" || true)"
    expected_digest="$(python3 -c 'import json,sys
try:
  d=json.loads(sys.stdin.read())
except Exception:
  d={}
print(d.get("currentReleaseDigest") or "")' <"$policy_stdout" || true)"
  fi
  if [ -n "$expected_id" ] && [ -n "$expected_digest" ]; then
    bundle_host="${work}/bundle.json"
    cp "$bundle_path" "$bundle_host"
    chmod 600 "$bundle_host"
    # Extra -v on compose run. Do not copy into bridge-artifacts (Caddy serves that tree).
    probe adopt_check ops_in_image \
      -v "${bundle_host}:/tmp/wiseeff-collect-bundle.json:ro" -- \
      adopt --check \
      --expected-id "$expected_id" \
      --expected-digest "$expected_digest" \
      --bundle /tmp/wiseeff-collect-bundle.json \
      --actor "$actor" \
      --verification-digest "$verification_digest" \
      --data-mode "$data_mode"
  else
    printf '%s\n' "skip adopt --check: policy status did not include currentReleaseId/currentReleaseDigest" >"${work}/adopt_check.stderr"
    : >"${work}/adopt_check.stdout"
    printf '1\n' >"${work}/adopt_check.code"
  fi
fi

if [ -n "$user_id" ] && [ -n "$organization_id" ] && [ "$manager_dsn_configured" = "true" ]; then
  for cap in catalog:author catalog:publish catalog:review-high-risk; do
    name="capability_$(printf '%s' "$cap" | tr ':/' '_')"
    probe "$name" ops_in_image capabilities status \
      --user-id "$user_id" --organization-id "$organization_id" --capability "$cap"
  done
fi

python3 - "$work" "$out_path" "$manager_dsn_configured" "$actor" "$data_mode" <<'PY'
import json, pathlib, stat, sys
work = pathlib.Path(sys.argv[1])
out_path = pathlib.Path(sys.argv[2])
manager_configured = sys.argv[3] == "true"
actor = sys.argv[4]
data_mode = sys.argv[5]

def load_probe(name: str) -> dict:
    code_path = work / f"{name}.code"
    if not code_path.exists():
        return {"skipped": True}
    stdout = (work / f"{name}.stdout").read_text(encoding="utf-8", errors="replace")
    stderr = (work / f"{name}.stderr").read_text(encoding="utf-8", errors="replace")
    code = int((work / f"{name}.code").read_text().strip() or "1")
    payload = None
    text = stdout.strip()
    if text:
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            payload = text
    return {"skipped": False, "exitCode": code, "payload": payload, "stderr": stderr.strip()}

probes = {}
for path in sorted(work.glob("*.code")):
    probes[path.stem] = load_probe(path.stem)

policy = probes.get("policy_status", {})
policy_payload = policy.get("payload") if isinstance(policy, dict) else None
pins = None
if isinstance(policy_payload, dict):
    frozen = policy_payload.get("frozen")
    adopted = policy_payload.get("adopted")
    pins = {
        "databaseOid": policy_payload.get("databaseOid"),
        "databaseName": policy_payload.get("databaseName"),
        "expectedCurrentId": policy_payload.get("currentReleaseId"),
        "expectedCurrentDigest": policy_payload.get("currentReleaseDigest"),
        "expectedPolicyRevision": policy_payload.get("policyRevision"),
        "expectedFrozen": frozen,
        "expectedAdopted": adopted,
        "publicationEnabled": policy_payload.get("publicationEnabled"),
        "lowRiskSingleActorPublish": policy_payload.get("lowRiskSingleActorPublish"),
        "artifactDigest": policy_payload.get("artifactDigest"),
        "artifactSourceKind": policy_payload.get("artifactSourceKind"),
        "receiptKinds": policy_payload.get("receiptKinds"),
        "capabilityContractRevision": policy_payload.get("capabilityContractRevision"),
    }

def bool_flag(value):
    if value is True:
        return "true"
    if value is False:
        return "false"
    return None

policy_check_enable_argv = None
if isinstance(pins, dict) and all(
    pins.get(key) not in (None, "")
    for key in (
        "databaseOid",
        "expectedCurrentId",
        "expectedCurrentDigest",
        "expectedPolicyRevision",
        "expectedFrozen",
        "expectedAdopted",
    )
):
    policy_check_enable_argv = [
        "npx tsx scripts/catalog-publication-ops.ts",
        "policy check enable",
        "--actor <authorized-user-id>",
        f"--expected-database-oid {pins['databaseOid']}",
        f"--expected-id {pins['expectedCurrentId']}",
        f"--expected-digest {pins['expectedCurrentDigest']}",
        f"--expected-policy-revision {pins['expectedPolicyRevision']}",
        f"--expected-frozen {bool_flag(pins['expectedFrozen'])}",
        f"--expected-adopted {bool_flag(pins['expectedAdopted'])}",
    ]

next_actions = []
if not manager_configured:
    next_actions.append(
        "provision dedicated manager LOGIN; copy manager DSN into .env.publication-manager; do not copy DATABASE_URL"
    )
if isinstance(policy_payload, dict):
    if policy_payload.get("adopted") is False:
        next_actions.append(
            "inspect + adopt --check/--execute with the exact current id/digest and source bundle"
        )
    if policy_payload.get("frozen") is True:
        next_actions.append("do not enable publication while freeze is set unless this upgrade owns the freeze")
    if policy_payload.get("publicationEnabled") is False:
        next_actions.append(
            "after adopt, run policy check enable then policy enable with pinsForPolicyCheck; do not use ephemeral confirmation on a durable name"
        )
    if policy_payload.get("publicationEnabled") is True:
        next_actions.append(
            "page loop on /parameter-admin/specs and workbench Submit selected; do not POST save APIs"
        )
ops_cli = probes.get("ops_cli_present", {})
if isinstance(ops_cli, dict) and ops_cli.get("exitCode") not in (0, None) and not ops_cli.get("skipped"):
    next_actions.append(
        "running image is missing scripts/catalog-publication-ops.ts; upgrade before inspect/adopt/policy"
    )
if not next_actions:
    next_actions.append("review failed probes in this report before any write")

report = {
    "kind": "catalog-publication-status-collection",
    "writes": False,
    "managerDsnConfigured": manager_configured,
    "dataMode": data_mode,
    "adoptCheckActorRecorded": actor,
    "pinsForPolicyCheck": pins,
    "policyCheckEnableArgv": policy_check_enable_argv,
    "nextActions": next_actions,
    "probes": probes,
}
out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
out_path.chmod(stat.S_IRUSR | stat.S_IWUSR)
print(str(out_path))
PY

printf '%s\n' "wrote ${out_path} (mode 0600, no DSNs)"
printf '%s\n' "This script does not enable publication, adopt, or grant capabilities."
