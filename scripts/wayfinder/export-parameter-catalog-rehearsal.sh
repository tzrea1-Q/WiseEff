#!/usr/bin/env bash
set -euo pipefail

umask 077
export LC_ALL=C

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
sql_dir="${script_dir}/sql"

container_name=""
compose_file=""
env_file=""
database_name="wiseeff"
database_user="wiseeff"
output_dir=""
fixture_mode=""
historical_source_commit="6c3adfc35c0e3be6d5d381013dace9408190380e"
historical_bundle_sha256="017b3e614f1f4eba5a70f0c6b0cd3316b7e5ebd1aa9ccec4cf8e514c56dba7ff"
secret_pattern='postgres(ql)?://[^[:space:]]+:[^[:space:]@]+@|password[[:space:]]*(=|=>)[[:space:]]*[^[:space:],;)]{3,}|password[[:space:]]+[^[:space:],;)]{3,}|PGPASSWORD[[:space:]]*=|(access[_-]?token|api[_-]?key|client[_-]?secret|secret|token)[[:space:]]*(=|=>)[[:space:]]*[^[:space:],;)]{8,}|bearer[[:space:]]+[A-Za-z0-9._-]{16,}|BEGIN[[:space:]]+[^[:space:]]*[[:space:]]*PRIVATE[[:space:]]+KEY|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}'
sql_source_files=(
  columns.sql
  constraints.sql
  indexes.sql
  invariant-counts.sql
  migration-inventory.sql
  profile-schema.sql
  relations.sql
  row-classes.sql
  row-counts.sql
  synthetic-fixture-verify.sql
  synthetic-fixture.sql
  triggers.sql
)
artifact_files=(
  schema.sql
  profile-schema.sql
  synthetic-fixture.sql
  synthetic-fixture-verify.sql
  relations.csv
  columns.csv
  constraints.csv
  indexes.csv
  triggers.csv
  migration-inventory.csv
  row-counts.csv
  row-classes.csv
  invariant-counts.csv
  manifest.csv
)

usage() {
  printf '%s\n' \
    'Usage:' \
    '  export-parameter-catalog-rehearsal.sh --fixture-mode populated|zero --output-dir ABSOLUTE_PATH --container NAME [--database NAME] [--user NAME]' \
    '  export-parameter-catalog-rehearsal.sh --fixture-mode populated|zero --output-dir ABSOLUTE_PATH --compose-file FILE --env-file FILE [--database NAME] [--user NAME]'
}

while (($# > 0)); do
  case "$1" in
    --container)
      container_name="${2:?missing value for --container}"
      shift 2
      ;;
    --compose-file)
      compose_file="${2:?missing value for --compose-file}"
      shift 2
      ;;
    --env-file)
      env_file="${2:?missing value for --env-file}"
      shift 2
      ;;
    --database)
      database_name="${2:?missing value for --database}"
      shift 2
      ;;
    --user)
      database_user="${2:?missing value for --user}"
      shift 2
      ;;
    --output-dir)
      output_dir="${2:?missing value for --output-dir}"
      shift 2
      ;;
    --fixture-mode)
      fixture_mode="${2:?missing value for --fixture-mode}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "${output_dir}" || "${output_dir}" != /* ]]; then
  printf '%s\n' '--output-dir must be an absolute path.' >&2
  exit 2
fi
output_basename="$(basename -- "${output_dir}")"
if [[ "${output_basename}" == -* ]]; then
  printf '%s\n' 'Artifact basename must not begin with a dash.' >&2
  exit 2
fi
if [[ ! "${output_basename}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  printf '%s\n' 'Artifact basename must use only letters, digits, dot, underscore, or dash.' >&2
  exit 2
fi

if [[ "${fixture_mode}" != "populated" && "${fixture_mode}" != "zero" ]]; then
  printf '%s\n' '--fixture-mode must be explicitly set to populated or zero.' >&2
  exit 2
fi

if [[ -n "${container_name}" && ( -n "${compose_file}" || -n "${env_file}" ) ]]; then
  printf '%s\n' 'Choose either --container or --compose-file/--env-file.' >&2
  exit 2
fi

if [[ -z "${container_name}" ]]; then
  if [[ -z "${compose_file}" || -z "${env_file}" ]]; then
    printf '%s\n' 'Compose mode requires both --compose-file and --env-file.' >&2
    exit 2
  fi
  if [[ ! -f "${compose_file}" || ! -f "${env_file}" ]]; then
    printf '%s\n' 'Compose file or env file does not exist.' >&2
    exit 2
  fi
fi

if [[ ! "${database_name}" =~ ^[A-Za-z0-9_]+$ || ! "${database_user}" =~ ^[A-Za-z0-9_]+$ ]]; then
  printf '%s\n' 'Database and user names must contain only letters, digits, and underscore.' >&2
  exit 2
fi

if [[ -e "${output_dir}" || -e "${output_dir}.tar.gz" || -e "${output_dir}.tar.gz.sha256" ]]; then
  printf '%s\n' 'Output path or archive already exists; refusing to overwrite it.' >&2
  exit 2
fi

output_parent="$(dirname "${output_dir}")"
if [[ ! -d "${output_parent}" || ! -w "${output_parent}" ]]; then
  printf '%s\n' 'Output parent must already exist and be writable.' >&2
  exit 2
fi

db_psql() {
  if [[ -n "${container_name}" ]]; then
    docker exec -i "${container_name}" \
      psql -X -q --no-psqlrc --set=ON_ERROR_STOP=1 \
      -U "${database_user}" -d "${database_name}" "$@"
  else
    docker compose --env-file "${env_file}" -f "${compose_file}" exec -T postgres \
      psql -X -q --no-psqlrc --set=ON_ERROR_STOP=1 \
      -U "${database_user}" -d "${database_name}" "$@"
  fi
}

db_dump_schema() {
  if [[ -n "${container_name}" ]]; then
    docker exec -i "${container_name}" \
      pg_dump -U "${database_user}" -d "${database_name}" "$@"
  else
    docker compose --env-file "${env_file}" -f "${compose_file}" exec -T postgres \
      pg_dump -U "${database_user}" -d "${database_name}" "$@"
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

sha256_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

is_registered_name() {
  local candidate="$1"
  shift
  local registered
  for registered in "$@"; do
    if [[ "${candidate}" == "${registered}" ]]; then
      return 0
    fi
  done
  return 1
}

scan_file_for_secrets() {
  local file_path="$1"
  local display_name="$2"
  if LC_ALL=C grep -aEiq "${secret_pattern}" "${file_path}"; then
    printf 'Sensitive-token pattern detected in %s.\n' "${display_name}" >&2
    return 1
  fi
}

validate_no_psql_meta_commands() {
  local sql_file="$1"
  node --input-type=module - "${sql_file}" <<'NODE'
import fs from "node:fs";

const source = fs.readFileSync(process.argv[2], "utf8");
let index = 0;
let state = "sql";
let blockCommentDepth = 0;
let dollarTag = "";

function fail() {
  process.exit(1);
}

while (index < source.length) {
  if (state === "line-comment") {
    if (source[index] === "\n") state = "sql";
    index += 1;
    continue;
  }
  if (state === "block-comment") {
    if (source.startsWith("/*", index)) {
      blockCommentDepth += 1;
      index += 2;
    } else if (source.startsWith("*/", index)) {
      blockCommentDepth -= 1;
      index += 2;
      if (blockCommentDepth === 0) state = "sql";
    } else {
      index += 1;
    }
    continue;
  }
  if (state === "single-quote" || state === "escape-string") {
    if (state === "escape-string" && source[index] === "\\") {
      index += Math.min(2, source.length - index);
    } else if (source[index] === "'" && source[index + 1] === "'") {
      index += 2;
    } else if (source[index] === "'") {
      state = "sql";
      index += 1;
    } else {
      index += 1;
    }
    continue;
  }
  if (state === "quoted-identifier") {
    if (source[index] === '"' && source[index + 1] === '"') {
      index += 2;
    } else if (source[index] === '"') {
      state = "sql";
      index += 1;
    } else {
      index += 1;
    }
    continue;
  }
  if (state === "dollar-quote") {
    if (source.startsWith(dollarTag, index)) {
      index += dollarTag.length;
      dollarTag = "";
      state = "sql";
    } else {
      index += 1;
    }
    continue;
  }

  if (source.startsWith("--", index)) {
    state = "line-comment";
    index += 2;
  } else if (source.startsWith("/*", index)) {
    state = "block-comment";
    blockCommentDepth = 1;
    index += 2;
  } else if ((source[index] === "E" || source[index] === "e") && source[index + 1] === "'") {
    state = "escape-string";
    index += 2;
  } else if (source[index] === "'") {
    state = "single-quote";
    index += 1;
  } else if (source[index] === '"') {
    state = "quoted-identifier";
    index += 1;
  } else if (source[index] === "$") {
    const tag = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u)?.[0];
    if (tag) {
      dollarTag = tag;
      state = "dollar-quote";
      index += tag.length;
    } else {
      index += 1;
    }
  } else if (source[index] === "\\") {
    fail();
  } else {
    index += 1;
  }
}

if (!["sql", "line-comment"].includes(state)) fail();
NODE
}

path_identity() {
  node --input-type=module - "$1" <<'NODE'
import fs from "node:fs";
const value = fs.lstatSync(process.argv[2], { bigint: true });
if (!value.isDirectory() || value.isSymbolicLink()) process.exit(1);
process.stdout.write(`${value.dev}:${value.ino}`);
NODE
}

new_owner_token() {
  node --input-type=module - <<'NODE'
import crypto from "node:crypto";
process.stdout.write(crypto.randomBytes(32).toString("hex"));
NODE
}

initialize_owned_directory() {
  printf '%s\n' "$2" > "$1/.wiseeff-owner"
  chmod 0400 "$1/.wiseeff-owner"
}

cleanup_owned_directory() {
  local owned_path="$1"
  local expected_identity="$2"
  local owner_token="$3"
  shift 3
  python3 - "${owned_path}" "${expected_identity}" "${owner_token}" "$@" <<'PY'
import os
import stat
import sys

owned_path, expected_identity, owner_token, *allowed_names = sys.argv[1:]
parent_path = os.path.dirname(owned_path)
entry_name = os.path.basename(owned_path)
allowed = {".wiseeff-owner", *allowed_names}
parent_fd = directory_fd = None
try:
    parent_fd = os.open(parent_path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    directory_fd = os.open(entry_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
    opened = os.fstat(directory_fd)
    if f"{opened.st_dev}:{opened.st_ino}" != expected_identity:
        raise RuntimeError("identity")
    entries = os.listdir(directory_fd)
    if any(name not in allowed for name in entries):
        raise RuntimeError("unknown-entry")
    marker_stat = os.stat(".wiseeff-owner", dir_fd=directory_fd, follow_symlinks=False)
    if not stat.S_ISREG(marker_stat.st_mode):
        raise RuntimeError("marker-kind")
    marker_fd = os.open(".wiseeff-owner", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory_fd)
    try:
        marker = os.read(marker_fd, 4096).decode("utf-8").strip()
    finally:
        os.close(marker_fd)
    if marker != owner_token:
        raise RuntimeError("marker-token")
    for name in entries:
        value = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if not stat.S_ISREG(value.st_mode):
            raise RuntimeError("entry-kind")
    os.fchmod(directory_fd, 0o700)
    for name in entries:
        current = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if not stat.S_ISREG(current.st_mode):
            raise RuntimeError("entry-replaced")
        os.unlink(name, dir_fd=directory_fd)
    current_dir = os.stat(entry_name, dir_fd=parent_fd, follow_symlinks=False)
    if f"{current_dir.st_dev}:{current_dir.st_ino}" != expected_identity:
        raise RuntimeError("path-replaced")
    os.rmdir(entry_name, dir_fd=parent_fd)
except Exception:
    sys.exit(1)
finally:
    if directory_fd is not None:
        os.close(directory_fd)
    if parent_fd is not None:
        os.close(parent_fd)
PY
}

remove_owned_directory_marker() {
  local owned_path="$1"
  local expected_identity="$2"
  local owner_token="$3"
  shift 3
  python3 - "${owned_path}" "${expected_identity}" "${owner_token}" "$@" <<'PY'
import os
import stat
import sys

owned_path, expected_identity, owner_token, *allowed_names = sys.argv[1:]
parent_path = os.path.dirname(owned_path)
entry_name = os.path.basename(owned_path)
allowed = {".wiseeff-owner", *allowed_names}
parent_fd = directory_fd = None
try:
    parent_fd = os.open(parent_path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    directory_fd = os.open(entry_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
    opened = os.fstat(directory_fd)
    if f"{opened.st_dev}:{opened.st_ino}" != expected_identity:
        raise RuntimeError("identity")
    entries = os.listdir(directory_fd)
    if any(name not in allowed for name in entries):
        raise RuntimeError("unknown-entry")
    marker_stat = os.stat(".wiseeff-owner", dir_fd=directory_fd, follow_symlinks=False)
    if not stat.S_ISREG(marker_stat.st_mode):
        raise RuntimeError("marker-kind")
    marker_fd = os.open(".wiseeff-owner", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory_fd)
    try:
        marker = os.read(marker_fd, 4096).decode("utf-8").strip()
    finally:
        os.close(marker_fd)
    if marker != owner_token:
        raise RuntimeError("marker-token")
    current = os.stat(".wiseeff-owner", dir_fd=directory_fd, follow_symlinks=False)
    if not stat.S_ISREG(current.st_mode):
        raise RuntimeError("marker-replaced")
    os.unlink(".wiseeff-owner", dir_fd=directory_fd)
except Exception:
    sys.exit(1)
finally:
    if directory_fd is not None:
        os.close(directory_fd)
    if parent_fd is not None:
        os.close(parent_fd)
PY
}

path_identity_file() {
  node --input-type=module - "$1" <<'NODE'
import fs from "node:fs";
const value = fs.lstatSync(process.argv[2], { bigint: true });
if (!value.isFile() || value.isSymbolicLink()) process.exit(1);
process.stdout.write(`${value.dev}:${value.ino}`);
NODE
}

cleanup_published_outputs() {
  local output_path="$1"
  local output_identity="$2"
  local stage_path="$3"
  local stage_expected_identity="$4"
  local token="$5"
  local archive_name="$6"
  local archive_identity="$7"
  local checksum_name="$8"
  local checksum_identity="$9"
  shift 9
  python3 - \
    "${output_path}" "${output_identity}" "${stage_path}" "${stage_expected_identity}" \
    "${token}" "${archive_name}" "${archive_identity}" \
    "${checksum_name}" "${checksum_identity}" "$@" <<'PY'
import os
import stat
import sys

(
    output_path,
    output_identity,
    stage_path,
    stage_identity,
    owner_token,
    archive_name,
    archive_identity,
    checksum_name,
    checksum_identity,
    *file_names,
) = sys.argv[1:]
parent_path = os.path.dirname(output_path)
output_name = os.path.basename(output_path)
stage_name = os.path.basename(stage_path)
parent_fd = output_fd = stage_fd = None

def identity(value):
    return f"{value.st_dev}:{value.st_ino}"

try:
    parent_fd = os.open(parent_path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    stage_fd = os.open(stage_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
    if identity(os.fstat(stage_fd)) != stage_identity:
        raise RuntimeError("stage-identity")
    if output_identity:
        output_fd = os.open(output_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
        if identity(os.fstat(output_fd)) != output_identity:
            raise RuntimeError("output-identity")
        entries = set(os.listdir(output_fd))
        if entries != {".wiseeff-owner", *file_names}:
            raise RuntimeError("output-world")
        marker_fd = os.open(".wiseeff-owner", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=output_fd)
        try:
            marker = os.read(marker_fd, 4096).decode("utf-8").strip()
        finally:
            os.close(marker_fd)
        if marker != owner_token:
            raise RuntimeError("marker-token")
        for name in [".wiseeff-owner", *file_names]:
            output_stat = os.stat(name, dir_fd=output_fd, follow_symlinks=False)
            stage_stat = os.stat(name, dir_fd=stage_fd, follow_symlinks=False)
            if not stat.S_ISREG(output_stat.st_mode) or identity(output_stat) != identity(stage_stat):
                raise RuntimeError("output-entry")
    for name, expected in ((archive_name, archive_identity), (checksum_name, checksum_identity)):
        if expected:
            value = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            if not stat.S_ISREG(value.st_mode) or identity(value) != expected:
                raise RuntimeError("published-file")

    for name, expected in ((checksum_name, checksum_identity), (archive_name, archive_identity)):
        if expected:
            value = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            if identity(value) != expected:
                raise RuntimeError("published-file-replaced")
            os.unlink(name, dir_fd=parent_fd)
    if output_fd is not None:
        for name in file_names:
            output_stat = os.stat(name, dir_fd=output_fd, follow_symlinks=False)
            stage_stat = os.stat(name, dir_fd=stage_fd, follow_symlinks=False)
            if identity(output_stat) != identity(stage_stat):
                raise RuntimeError("output-entry-replaced")
            os.unlink(name, dir_fd=output_fd)
        marker_stat = os.stat(".wiseeff-owner", dir_fd=output_fd, follow_symlinks=False)
        stage_marker_stat = os.stat(".wiseeff-owner", dir_fd=stage_fd, follow_symlinks=False)
        if identity(marker_stat) != identity(stage_marker_stat):
            raise RuntimeError("marker-replaced")
        os.unlink(".wiseeff-owner", dir_fd=output_fd)
        current = os.stat(output_name, dir_fd=parent_fd, follow_symlinks=False)
        if identity(current) != output_identity:
            raise RuntimeError("output-replaced")
        os.rmdir(output_name, dir_fd=parent_fd)
except Exception:
    sys.exit(1)
finally:
    if stage_fd is not None:
        os.close(stage_fd)
    if output_fd is not None:
        os.close(output_fd)
    if parent_fd is not None:
        os.close(parent_fd)
PY
}

snapshot_source_directory() {
  local source_path="$1"
  local destination_path="$2"
  shift 2
  node --input-type=module - "${source_path}" "${destination_path}" "$@" <<'NODE'
import fs from "node:fs";
import path from "node:path";
const [sourcePath, destinationPath, ...expectedNames] = process.argv.slice(2);
const expected = [...expectedNames].sort();
let directoryFd;
try {
  directoryFd = fs.openSync(
    sourcePath,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  const opened = fs.fstatSync(directoryFd, { bigint: true });
  process.chdir(sourcePath);
  const current = fs.statSync(".", { bigint: true });
  if (`${opened.dev}:${opened.ino}` !== `${current.dev}:${current.ino}`) throw new Error("directory");
  const actual = fs.readdirSync(".").sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("closed-world");
  for (const name of expected) {
    let sourceFd;
    let destinationFd;
    try {
      sourceFd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const before = fs.fstatSync(sourceFd, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink()) throw new Error("source-kind");
      const bytes = fs.readFileSync(sourceFd);
      const after = fs.fstatSync(sourceFd, { bigint: true });
      if (
        before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      ) throw new Error("source-changed");
      destinationFd = fs.openSync(
        path.join(destinationPath, name),
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
          | fs.constants.O_NOFOLLOW,
        0o400,
      );
      fs.writeFileSync(destinationFd, bytes);
      fs.fsyncSync(destinationFd);
      fs.closeSync(destinationFd);
      destinationFd = undefined;
    } finally {
      if (sourceFd !== undefined) fs.closeSync(sourceFd);
      if (destinationFd !== undefined) fs.closeSync(destinationFd);
    }
  }
  if (JSON.stringify(fs.readdirSync(".").sort()) !== JSON.stringify(expected)) {
    throw new Error("source-world-changed");
  }
  process.chdir("/");
  fs.closeSync(directoryFd);
} catch {
  try { process.chdir("/"); } catch {}
  if (directoryFd !== undefined) fs.closeSync(directoryFd);
  process.exit(1);
}
NODE
}

source_snapshot_dir="$(mktemp -d "${TMPDIR:-/tmp}/wiseeff-wayfinder671-export-input.XXXXXX")"
source_snapshot_token="$(new_owner_token)"
initialize_owned_directory "${source_snapshot_dir}" "${source_snapshot_token}"
source_snapshot_identity="$(path_identity "${source_snapshot_dir}")"
cleanup_source_snapshot_on_exit() {
  local exit_code=$?
  trap - EXIT
  if ! cleanup_owned_directory \
    "${source_snapshot_dir}" "${source_snapshot_identity}" "${source_snapshot_token}" \
    "${sql_source_files[@]}"; then
    printf '%s\n' 'CLEANUP_FAILED' >&2
    exit 1
  fi
  exit "${exit_code}"
}
trap cleanup_source_snapshot_on_exit EXIT

if ! snapshot_source_directory "${sql_dir}" "${source_snapshot_dir}" "${sql_source_files[@]}"; then
  printf '%s\n' 'Wayfinder SQL source changed or is not the exact regular-file closed world.' >&2
  exit 1
fi
chmod 0500 "${source_snapshot_dir}"
sql_dir="${source_snapshot_dir}"

if [[ ! -d "${sql_dir}" || -L "${sql_dir}" ]]; then
  printf '%s\n' 'Wayfinder SQL source directory must be a regular, non-symlink directory.' >&2
  exit 1
fi
for file in "${sql_source_files[@]}"; do
  if [[ ! -f "${sql_dir}/${file}" || -L "${sql_dir}/${file}" ]]; then
    printf 'Required Wayfinder SQL source is not a regular file: %s\n' "${file}" >&2
    exit 1
  fi
done
while IFS= read -r -d '' entry; do
  file="$(basename "${entry}")"
  if [[ "${file}" == ".wiseeff-owner" ]]; then
    continue
  fi
  if ! is_registered_name "${file}" "${sql_source_files[@]}"; then
    printf 'Unknown Wayfinder SQL source entry: %s\n' "${file}" >&2
    exit 1
  fi
  if [[ ! -f "${entry}" || -L "${entry}" ]]; then
    printf 'Wayfinder SQL source entry must be a regular non-symlink file: %s\n' "${file}" >&2
    exit 1
  fi
done < <(find "${sql_dir}" -mindepth 1 -maxdepth 1 -print0)
for file in "${sql_source_files[@]}"; do
  scan_file_for_secrets "${sql_dir}/${file}" "scripts/wayfinder/sql/${file}"
done

required_relations=(
  schema_migrations
  organizations
  projects
  parameter_specs
  parameter_spec_versions
  attribution_subjects
  driver_registrations
  node_type_definitions
  driver_schemas
  driver_schema_versions
  dts_property_specs
  parameter_modules
  parameter_module_mappings
  driver_registration_placements
  project_parameter_bindings
  project_parameter_binding_revisions
  parameter_drafts
  parameter_change_requests
  parameter_history_entries
  parameter_spec_review_tasks
  identity_mapping_tasks
  legacy_parameter_migration_evidence
  driver_schema_overlays
  driver_schema_overlay_properties
)

required_values=""
for relation in "${required_relations[@]}"; do
  if [[ -n "${required_values}" ]]; then
    required_values+=","
  fi
  required_values+="('${relation}')"
done

read_only_state="$(db_psql -Atc "begin transaction read only; select current_setting('transaction_read_only'); rollback;")"
if [[ "${read_only_state}" != "on" ]]; then
  printf '%s\n' 'Could not prove a read-only transaction; refusing to export.' >&2
  exit 1
fi

missing_relations="$(db_psql -Atc "with required(name) as (values ${required_values}) select string_agg(name, ', ' order by name) from required where to_regclass('public.' || name) is null;")"
if [[ -n "${missing_relations}" ]]; then
  printf 'Required relations are missing: %s\n' "${missing_relations}" >&2
  exit 1
fi

unsafe_external_objects="$(db_psql -Atc "
  select
    (select count(*) from pg_subscription
      where subdbid = (select oid from pg_database where datname = current_database()))
    + (select count(*) from pg_foreign_data_wrapper)
    + (select count(*) from pg_foreign_server)
    + (select count(*) from pg_user_mapping)
")"
if [[ "${unsafe_external_objects}" != "0" ]]; then
  printf '%s\n' 'Source database contains external or credential-bearing objects; refusing to export.' >&2
  exit 1
fi

archive_path="${output_dir}.tar.gz"
archive_checksum_path="${archive_path}.sha256"
stage_dir="$(mktemp -d "${output_dir}.tmp.XXXXXX")"
owner_marker_name=".wiseeff-owner"
stage_owner_marker="${stage_dir}/${owner_marker_name}"
output_owner_marker="${output_dir}/${owner_marker_name}"
owner_token="$(new_owner_token)"
initialize_owned_directory "${stage_dir}" "${owner_token}"
stage_identity="$(path_identity "${stage_dir}")"
stage_possible_files=(
  "${artifact_files[@]}"
  SHA256SUMS
  combined-profile.out
  migration-inventory-after-schema.csv
  archive.tar.gz
  archive.tar.gz.sha256
)
output_owned="false"
output_identity=""
archive_temp=""
archive_published="false"
archive_identity=""
archive_checksum_temp=""
archive_checksum_published="false"
archive_checksum_identity=""
on_exit() {
  local exit_code=$?
  if [[ "${exit_code}" == "0" ]]; then
    return
  fi
  trap - EXIT
  local cleanup_failed="false"
  set +e
  if [[ "${output_owned}" == "true" || "${archive_published}" == "true" \
     || "${archive_checksum_published}" == "true" ]]; then
    if ! cleanup_published_outputs \
      "${output_dir}" "$([[ "${output_owned}" == "true" ]] && printf '%s' "${output_identity}")" \
      "${stage_dir}" "${stage_identity}" "${owner_token}" \
      "$(basename -- "${archive_path}")" "${archive_identity}" \
      "$(basename -- "${archive_checksum_path}")" "${archive_checksum_identity}" \
      "${artifact_files[@]}" SHA256SUMS; then
      cleanup_failed="true"
    fi
  fi
  if ! cleanup_owned_directory \
    "${stage_dir}" "${stage_identity}" "${owner_token}" \
    "${stage_possible_files[@]}"; then
    cleanup_failed="true"
  fi
  if ! cleanup_owned_directory \
    "${source_snapshot_dir}" "${source_snapshot_identity}" "${source_snapshot_token}" \
    "${sql_source_files[@]}"; then
    cleanup_failed="true"
  fi
  printf '%s\n' 'EXPORT_FAILED' >&2
  if [[ "${cleanup_failed}" == "true" ]]; then
    printf '%s\n' 'CLEANUP_FAILED' >&2
    exit 1
  fi
  exit "${exit_code}"
}
trap on_exit EXIT

reports=(relations columns constraints indexes triggers migration-inventory row-counts row-classes invariant-counts)
combined_output="${stage_dir}/combined-profile.out"
{
  printf '%s\n' 'begin transaction isolation level repeatable read read only;'
  for report in "${reports[@]}"; do
    printf '%s\n' '\pset tuples_only off'
    printf '\\qecho __WISEEFF_WAYFINDER_671_SECTION_%s__\n' "${report}"
    sed -e '/^begin transaction isolation level repeatable read read only;$/d' \
      -e '/^commit;$/d' "${sql_dir}/${report}.sql"
  done
  printf '%s\n' '\qecho __WISEEFF_WAYFINDER_671_SECTION_END__' 'commit;'
} | db_psql > "${combined_output}"
scan_file_for_secrets "${combined_output}" "combined-profile.out"

awk -v output_dir="${stage_dir}" '
  /^__WISEEFF_WAYFINDER_671_SECTION_END__$/ {
    if (output_file != "") close(output_file)
    output_file = ""
    next
  }
  /^__WISEEFF_WAYFINDER_671_SECTION_[a-z-]+__$/ {
    if (output_file != "") close(output_file)
    section = $0
    sub(/^__WISEEFF_WAYFINDER_671_SECTION_/, "", section)
    sub(/__$/, "", section)
    output_file = output_dir "/" section ".csv"
    next
  }
  output_file != "" { print > output_file }
' "${combined_output}"

for report in "${reports[@]}"; do
  if [[ ! -s "${stage_dir}/${report}.csv" ]]; then
    printf 'Snapshot report is empty: %s\n' "${report}" >&2
    exit 1
  fi
done

if [[ "${fixture_mode}" == "zero" ]]; then
  nonzero_relations="$(awk -F, 'NR > 1 && $1 != "organizations" && ($2 + 0) != 0 { print $1 }' "${stage_dir}/row-counts.csv")"
  if [[ -n "${nonzero_relations}" ]]; then
    printf 'Zero fixture mode requires empty source inventory; non-zero relations: %s\n' \
      "$(printf '%s' "${nonzero_relations}" | paste -sd, -)" >&2
    exit 1
  fi
fi

db_dump_schema \
  --schema-only \
  --no-owner \
  --no-privileges \
  --no-comments \
  --no-security-labels \
  | sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' \
  > "${stage_dir}/schema.sql"

db_psql < "${sql_dir}/migration-inventory.sql" > "${stage_dir}/migration-inventory-after-schema.csv"
scan_file_for_secrets "${stage_dir}/migration-inventory-after-schema.csv" "migration-inventory-after-schema.csv"
if ! cmp -s "${stage_dir}/migration-inventory.csv" "${stage_dir}/migration-inventory-after-schema.csv"; then
  printf '%s\n' 'Migration inventory changed while the schema dump was captured; retry outside a deployment window.' >&2
  exit 1
fi

cp "${sql_dir}/profile-schema.sql" "${stage_dir}/profile-schema.sql"
cp "${sql_dir}/synthetic-fixture.sql" "${stage_dir}/synthetic-fixture.sql"
cp "${sql_dir}/synthetic-fixture-verify.sql" "${stage_dir}/synthetic-fixture-verify.sql"

if grep -Eq '^COPY public\.|^INSERT INTO public\.' "${stage_dir}/schema.sql"; then
  printf '%s\n' 'Schema dump unexpectedly contains public data statements.' >&2
  exit 1
fi

schema_checksum="$({
  for file in relations.csv columns.csv constraints.csv indexes.csv triggers.csv; do
    printf 'FILE:%s\n' "${file}"
    sed 's/\r$//' "${stage_dir}/${file}"
  done
} | sha256_stream)"

source_database_checksum="$({
  for file in migration-inventory.csv row-counts.csv row-classes.csv invariant-counts.csv; do
    printf 'FILE:%s\n' "${file}"
    sed 's/\r$//' "${stage_dir}/${file}"
  done
} | sha256_stream)"

schema_dump_file_checksum="$(sha256_file "${stage_dir}/schema.sql")"
synthetic_fixture_verify_checksum="$(sha256_file "${stage_dir}/synthetic-fixture-verify.sql")"
schema_dump_canonical_checksum="$(
  sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' "${stage_dir}/schema.sql" | sha256_stream
)"
migration_count="$(awk 'END { print NR - 1 }' "${stage_dir}/migration-inventory.csv")"
last_migration="$(tail -n 1 "${stage_dir}/migration-inventory.csv" | cut -d, -f1)"
server_version_num="$(db_psql -Atc "select current_setting('server_version_num')")"
export_commit="$(git -C "${repo_root}" rev-parse HEAD)"
exported_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
artifact_kind="parameter-catalog-${fixture_mode}-rehearsal-fixture"
import_populates_synthetic_rows="false"
if [[ "${fixture_mode}" == "populated" ]]; then
  import_populates_synthetic_rows="true"
fi

{
  printf 'key,value\n'
  printf 'format_version,2\n'
  printf 'artifact_kind,%s\n' "${artifact_kind}"
  printf 'fixture_mode,%s\n' "${fixture_mode}"
  printf 'data_rows_exported,0\n'
  printf 'source_data_rows_exported,0\n'
  printf 'synthetic_fixture_version,1\n'
  printf 'import_populates_synthetic_rows,%s\n' "${import_populates_synthetic_rows}"
  printf 'historical_source_commit,%s\n' "${historical_source_commit}"
  printf 'historical_bundle_sha256,%s\n' "${historical_bundle_sha256}"
  printf 'synthetic_fixture_verify_sha256,%s\n' "${synthetic_fixture_verify_checksum}"
  printf 'database_identity,withheld\n'
  printf 'read_only_transaction_confirmed,true\n'
  printf 'profile_snapshot,repeatable-read-read-only\n'
  printf 'server_version_num,%s\n' "${server_version_num}"
  printf 'migration_count,%s\n' "${migration_count}"
  printf 'last_migration,%s\n' "${last_migration}"
  printf 'exporter_commit,%s\n' "${export_commit}"
  printf 'exported_at,%s\n' "${exported_at}"
  printf 'source_database_logical_checksum_sha256,%s\n' "${source_database_checksum}"
  printf 'schema_metadata_checksum_sha256,%s\n' "${schema_checksum}"
  printf 'schema_dump_canonical_sha256,%s\n' "${schema_dump_canonical_checksum}"
  printf 'schema_dump_file_sha256,%s\n' "${schema_dump_file_checksum}"
  printf 'sanitization_contract,structure-aggregates-and-deterministic-synthetic-rows\n'
} > "${stage_dir}/manifest.csv"

for file in "${artifact_files[@]}"; do
  if [[ ! -f "${stage_dir}/${file}" || -L "${stage_dir}/${file}" ]]; then
    printf 'Generated artifact entry is not a regular file: %s\n' "${file}" >&2
    exit 1
  fi
done
while IFS= read -r -d '' entry; do
  file="$(basename "${entry}")"
  if [[ "${file}" == "${owner_marker_name}" ]]; then
    continue
  fi
  if [[ "${file}" == "combined-profile.out" \
     || "${file}" == "migration-inventory-after-schema.csv" ]]; then
    continue
  fi
  if ! is_registered_name "${file}" "${artifact_files[@]}"; then
    printf 'Unknown generated artifact entry: %s\n' "${file}" >&2
    exit 1
  fi
  if [[ ! -f "${entry}" || -L "${entry}" ]]; then
    printf 'Generated artifact entry must be a regular non-symlink file: %s\n' "${file}" >&2
    exit 1
  fi
done < <(find "${stage_dir}" -mindepth 1 -maxdepth 1 -print0)
for file in "${artifact_files[@]}"; do
  scan_file_for_secrets "${stage_dir}/${file}" "${file}"
done
for file in schema.sql profile-schema.sql synthetic-fixture.sql synthetic-fixture-verify.sql; do
  if ! validate_no_psql_meta_commands "${stage_dir}/${file}"; then
    printf 'Unsafe psql meta-command detected in %s.\n' "${file}" >&2
    exit 1
  fi
done

(
  cd "${stage_dir}"
  for file in "${artifact_files[@]}"; do
    printf '%s  %s\n' "$(sha256_file "${file}")" "${file}"
  done | sort -k2
) > "${stage_dir}/SHA256SUMS"

if ! mkdir -- "${output_dir}"; then
  printf '%s\n' 'Output path appeared during export; refusing to publish into it.' >&2
  exit 1
fi
output_owned="true"
output_identity="$(path_identity "${output_dir}")"
ln -- "${stage_owner_marker}" "${output_owner_marker}"
for file in "${artifact_files[@]}" SHA256SUMS; do
  ln -- "${stage_dir}/${file}" "${output_dir}/${file}"
done

archive_temp="${stage_dir}/archive.tar.gz"
archive_members=()
for file in "${artifact_files[@]}" SHA256SUMS; do
  archive_members+=("$(basename "${output_dir}")/${file}")
done
tar -czf "${archive_temp}" -C "${output_parent}" -- "${archive_members[@]}"
if ! ln -- "${archive_temp}" "${archive_path}"; then
  printf '%s\n' 'Archive path appeared during export; refusing to overwrite it.' >&2
  exit 1
fi
archive_published="true"
archive_identity="$(path_identity_file "${archive_path}")"
archive_checksum="$(sha256_file "${archive_path}")"
archive_checksum_temp="${stage_dir}/archive.tar.gz.sha256"
printf '%s  %s\n' "${archive_checksum}" "$(basename "${archive_path}")" > "${archive_checksum_temp}"
if ! ln -- "${archive_checksum_temp}" "${archive_checksum_path}"; then
  printf '%s\n' 'Archive checksum path appeared during export; refusing to overwrite it.' >&2
  exit 1
fi
archive_checksum_published="true"
archive_checksum_identity="$(path_identity_file "${archive_checksum_path}")"

if [[ ! -e "${output_owner_marker}" || ! "${output_owner_marker}" -ef "${stage_owner_marker}" ]]; then
  printf '%s\n' 'Exporter ownership marker changed during publication.' >&2
  exit 1
fi
if ! remove_owned_directory_marker \
  "${output_dir}" "${output_identity}" "${owner_token}" \
  "${artifact_files[@]}" SHA256SUMS; then
  printf '%s\n' 'Exporter output ownership changed before publication completed.' >&2
  exit 1
fi
if ! cleanup_owned_directory \
  "${stage_dir}" "${stage_identity}" "${owner_token}" \
  "${stage_possible_files[@]}" \
  || ! cleanup_owned_directory \
    "${source_snapshot_dir}" "${source_snapshot_identity}" "${source_snapshot_token}" \
    "${sql_source_files[@]}"; then
  printf '%s\n' 'Exporter-owned temporary path cleanup failed.' >&2
  exit 1
fi
trap - EXIT

row_class_count="$(awk -F, '$1 == "parameter_specs" { print $2 }' "${output_dir}/row-counts.csv")"
printf '%s\n' \
  'EXPORT_OK' \
  "artifact_dir=${output_dir}" \
  "archive=${archive_path}" \
  "archive_sha256=${archive_checksum}" \
  "source_database_logical_checksum_sha256=${source_database_checksum}" \
  "schema_metadata_checksum_sha256=${schema_checksum}" \
  "schema_dump_canonical_sha256=${schema_dump_canonical_checksum}" \
  "schema_dump_file_sha256=${schema_dump_file_checksum}" \
  "source_parameter_spec_rows=${row_class_count}" \
  "fixture_mode=${fixture_mode}" \
  'data_rows_exported=0' \
  'source_data_rows_exported=0' \
  'database_identity=withheld'
