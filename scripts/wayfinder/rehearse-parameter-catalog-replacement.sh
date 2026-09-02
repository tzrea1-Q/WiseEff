#!/usr/bin/env bash
set -euo pipefail

umask 077
export LC_ALL=C

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixture_verify_file="${script_dir}/sql/synthetic-fixture-verify.sql"
container_name=""
database_name=""
database_user="wiseeff"
migration_file=""
validation_file=""
check_sql_only="false"
check_cleanup_only="false"
secret_pattern='postgres(ql)?://[^[:space:]]+:[^[:space:]@]+@|password[[:space:]]*(=|=>)[[:space:]]*[^[:space:],;)]{3,}|password[[:space:]]+[^[:space:],;)]{3,}|PGPASSWORD[[:space:]]*=|(access[_-]?token|api[_-]?key|client[_-]?secret|secret|token)[[:space:]]*(=|=>)[[:space:]]*[^[:space:],;)]{8,}|bearer[[:space:]]+[A-Za-z0-9._-]{16,}|BEGIN[[:space:]]+[^[:space:]]*[[:space:]]+PRIVATE[[:space:]]+KEY|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}'

usage() {
  printf '%s\n' \
    'Usage: rehearse-parameter-catalog-replacement.sh --container NAME --database wiseeff_wayfinder671_restore_SUFFIX --migration-file ABSOLUTE_PATH --validation-file ABSOLUTE_PATH [--user NAME]' \
    '       rehearse-parameter-catalog-replacement.sh --check-sql-only --migration-file ABSOLUTE_PATH --validation-file ABSOLUTE_PATH' \
    '       rehearse-parameter-catalog-replacement.sh --check-cleanup-only'
}

while (($# > 0)); do
  case "$1" in
    --container)
      container_name="${2:?missing value for --container}"
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
    --migration-file)
      migration_file="${2:?missing value for --migration-file}"
      shift 2
      ;;
    --validation-file)
      validation_file="${2:?missing value for --validation-file}"
      shift 2
      ;;
    --check-sql-only)
      check_sql_only="true"
      shift
      ;;
    --check-cleanup-only)
      check_cleanup_only="true"
      shift
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

if [[ "${check_cleanup_only}" != "true" ]]; then
  if [[ -z "${migration_file}" || -z "${validation_file}" ]]; then
    usage >&2
    exit 2
  fi
  if [[ "${check_sql_only}" != "true" \
     && ( -z "${container_name}" || -z "${database_name}" ) ]]; then
    usage >&2
    exit 2
  fi
fi

if [[ "${check_cleanup_only}" != "true" \
   && "${check_sql_only}" != "true" \
   && ! "${database_name}" =~ ^wiseeff_wayfinder671_restore_[a-z0-9_]+$ ]]; then
  printf '%s\n' 'Target database must use the dedicated wiseeff_wayfinder671_restore_ prefix.' >&2
  exit 2
fi

if [[ ! "${database_user}" =~ ^[A-Za-z0-9_]+$ ]]; then
  printf '%s\n' 'Database user must be a simple identifier.' >&2
  exit 2
fi

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
  local owned_path="$1"
  local owner_token="$2"
  printf '%s\n' "${owner_token}" > "${owned_path}/.wiseeff-owner"
  chmod 0400 "${owned_path}/.wiseeff-owner"
}

assert_owned_directory() {
  local owned_path="$1"
  local expected_identity="$2"
  local owner_token="$3"
  [[ -d "${owned_path}" && ! -L "${owned_path}" ]] \
    && [[ "$(path_identity "${owned_path}")" == "${expected_identity}" ]] \
    && [[ "$(<"${owned_path}/.wiseeff-owner")" == "${owner_token}" ]]
}

cleanup_owned_directory() {
  local owned_path="$1"
  local expected_identity="$2"
  local owner_token="$3"
  shift 3
  if ! python3 - "${owned_path}" "${expected_identity}" "${owner_token}" "$@" <<'PY'
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
  then
    printf '%s\n' 'CLEANUP_FAILED' >&2
    return 1
  fi
}

snapshot_regular_file() {
  local source_path="$1"
  local destination_path="$2"
  node --input-type=module - "${source_path}" "${destination_path}" <<'NODE'
import fs from "node:fs";

const [sourcePath, destinationPath] = process.argv.slice(2);
if (!sourcePath.startsWith("/")) process.exit(2);
let sourceFd;
let destinationFd;
try {
  sourceFd = fs.openSync(sourcePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const before = fs.fstatSync(sourceFd, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("source-kind");
  const bytes = fs.readFileSync(sourceFd);
  const after = fs.fstatSync(sourceFd, { bigint: true });
  if (
    before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
    || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
  ) throw new Error("source-changed");
  destinationFd = fs.openSync(
    destinationPath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    0o400,
  );
  fs.writeFileSync(destinationFd, bytes);
  fs.fsyncSync(destinationFd);
  fs.closeSync(destinationFd);
  destinationFd = undefined;
  fs.chmodSync(destinationPath, 0o400);
} catch {
  if (sourceFd !== undefined) fs.closeSync(sourceFd);
  if (destinationFd !== undefined) fs.closeSync(destinationFd);
  process.exit(1);
}
if (sourceFd !== undefined) fs.closeSync(sourceFd);
NODE
}

scan_file_for_secrets() {
  local file_path="$1"
  local display_name="$2"
  if LC_ALL=C grep -aEiq "${secret_pattern}" "${file_path}"; then
    printf 'Sensitive-token pattern detected in %s.\n' "${display_name}" >&2
    return 1
  fi
}

if [[ "${check_cleanup_only}" == "true" ]]; then
  cleanup_probe="$(mktemp -d "${TMPDIR:-/tmp}/wiseeff-wayfinder671-cleanup.XXXXXX")"
  cleanup_probe_token="$(new_owner_token)"
  initialize_owned_directory "${cleanup_probe}" "${cleanup_probe_token}"
  cleanup_probe_identity="$(path_identity "${cleanup_probe}")"
  : > "${cleanup_probe}/owned-resource"
  if ! cleanup_owned_directory \
    "${cleanup_probe}" "${cleanup_probe_identity}" "${cleanup_probe_token}" \
    owned-resource; then
    exit 1
  fi
  printf '%s\n' 'CLEANUP_OK'
  exit 0
fi

validate_sql_input() {
  local sql_file="$1"
  node --input-type=module - "${sql_file}" <<'NODE'
import fs from "node:fs";

const sqlPath = process.argv[2];
const sql = fs.readFileSync(sqlPath, "utf8");

function fail(reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(1);
}

function lex(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (source.startsWith("--", index)) {
      const newline = source.indexOf("\n", index + 2);
      index = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) {
          depth += 1;
          index += 2;
        } else if (source.startsWith("*/", index)) {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth !== 0) fail("Unterminated PostgreSQL block comment");
      continue;
    }
    if (character === "\\") {
      fail("psql meta-command is forbidden");
    }
    if (character === "'" || ((character === "e" || character === "E") && source[index + 1] === "'")) {
      const escapeString = character !== "'";
      if (escapeString) index += 1;
      index += 1;
      let value = "";
      let closed = false;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") {
          value += "'";
          index += 2;
          continue;
        }
        if (source[index] === "'") {
          index += 1;
          closed = true;
          break;
        }
        if (escapeString && source[index] === "\\" && index + 1 < source.length) {
          value += source[index + 1];
          index += 2;
          continue;
        }
        value += source[index];
        index += 1;
      }
      if (!closed) fail("Unterminated PostgreSQL string literal");
      tokens.push({ kind: "string", value });
      continue;
    }
    if (character === '"') {
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === '"' && source[index + 1] === '"') {
          index += 2;
        } else if (source[index] === '"') {
          index += 1;
          closed = true;
          break;
        } else {
          index += 1;
        }
      }
      if (!closed) fail("Unterminated PostgreSQL quoted identifier");
      tokens.push({ kind: "quoted-identifier", value: "" });
      continue;
    }
    if (character === "$") {
      const tag = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u)?.[0];
      if (tag) {
        const bodyStart = index + tag.length;
        const bodyEnd = source.indexOf(tag, bodyStart);
        if (bodyEnd === -1) fail("Unterminated PostgreSQL dollar-quoted string");
        tokens.push({ kind: "dollar-string", value: source.slice(bodyStart, bodyEnd) });
        index = bodyEnd + tag.length;
        continue;
      }
    }
    const word = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_$]*/u)?.[0];
    if (word) {
      tokens.push({ kind: "word", value: word.toLowerCase() });
      index += word.length;
      continue;
    }
    tokens.push({ kind: character === ";" ? "semicolon" : "symbol", value: character });
    index += 1;
  }
  return tokens;
}

function words(tokens) {
  return tokens.filter((token) => token.kind === "word").map((token) => token.value);
}

function hasSequence(values, sequence) {
  return values.some((_, index) =>
    sequence.every((value, offset) => values[index + offset] === value),
  );
}

function inspect(source, context = "top") {
  const tokens = lex(source);
  const statements = [];
  let statement = [];
  for (const token of tokens) {
    if (token.kind === "semicolon") {
      if (statement.length > 0) statements.push(statement);
      statement = [];
    } else {
      statement.push(token);
    }
  }
  if (statement.length > 0) statements.push(statement);

  for (const current of statements) {
    const values = words(current);
    const first = values[0];
    const permittedFirst = new Set([
      "alter",
      "comment",
      "create",
      "delete",
      "drop",
      "insert",
      "select",
      "set",
      "truncate",
      "update",
      "with",
    ]);
    if (!permittedFirst.has(first)) {
      fail(`SQL statement is outside the rehearsal allow-list: ${first ?? "empty"}`);
    }
    if (first === "create") {
      let objectIndex = 1;
      while (["temporary", "temp", "unlogged", "unique"].includes(values[objectIndex])) {
        objectIndex += 1;
      }
      if (!["index", "schema", "table"].includes(values[objectIndex])) {
        fail(`CREATE target is outside the rehearsal allow-list: ${values[objectIndex] ?? "unknown"}`);
      }
    }
    if (first === "alter" && values[1] !== "table") {
      fail(`ALTER target is outside the rehearsal allow-list: ${values[1] ?? "unknown"}`);
    }
    if (first === "drop" && !["index", "schema", "table"].includes(values[1])) {
      fail(`DROP target is outside the rehearsal allow-list: ${values[1] ?? "unknown"}`);
    }
    if (first === "set" && values[1] !== "constraints") {
      fail("Only SET CONSTRAINTS is accepted in candidate SQL");
    }

    const forbiddenCapabilities = new Set([
      "call",
      "copy",
      "dblink",
      "do",
      "execute",
      "extension",
      "language",
      "load",
      "mapping",
      "procedure",
      "program",
      "publication",
      "server",
      "subscription",
      "tablespace",
    ]);
    if (values.some((value) =>
      forbiddenCapabilities.has(value)
      || value.startsWith("dblink_")
      || value.startsWith("lo_")
      || value.startsWith("pg_read_")
      || value.startsWith("pg_write_")
    )) {
      fail("SQL statement requests a capability outside the rehearsal allow-list");
    }

    const permittedFunctions = new Set([
      "coalesce",
      "count",
      "length",
      "lower",
      "max",
      "min",
      "nullif",
      "substring",
      "trim",
      "upper",
    ]);
    const syntacticParentheses = new Set([
      "check",
      "and",
      "exists",
      "in",
      "key",
      "table",
      "or",
      "unique",
      "values",
      "when",
      "where",
    ]);
    const objectIntroducers = new Set(["into", "on", "references", "table"]);
    for (let index = 0; index + 1 < current.length; index += 1) {
      const token = current[index];
      if (current[index + 1].value !== "(" || token.kind === "symbol") continue;
      if (token.kind === "word" && (
        permittedFunctions.has(token.value)
        || syntacticParentheses.has(token.value)
      )) continue;
      const previousWord = [...current.slice(0, index)]
        .reverse()
        .find((candidate) => candidate.kind === "word")?.value;
      if (objectIntroducers.has(previousWord)) continue;
      fail(`Function or callable expression is outside the rehearsal allow-list: ${token.value}`);
    }
    const forbiddenFirst = new Set([
      "abort",
      "commit",
      "discard",
      "listen",
      "load",
      "prepare",
      "reset",
      "rollback",
      "savepoint",
      "unlisten",
    ]);
    if (context === "top") {
      forbiddenFirst.add("begin");
      forbiddenFirst.add("end");
    }
    if (forbiddenFirst.has(first)) fail(`Forbidden SQL control: ${first}`);
    if (hasSequence(values, ["start", "transaction"])) fail("Forbidden START TRANSACTION");
    if (hasSequence(values, ["prepare", "transaction"])) fail("Forbidden PREPARE TRANSACTION");
    if (hasSequence(values, ["release", "savepoint"])) fail("Forbidden RELEASE SAVEPOINT");
    if (first === "copy") fail("Forbidden SQL COPY");
    if (values.includes("set_config")) fail("Forbidden dynamic session configuration");
    if (first === "set" && values[1] !== "constraints") fail("Forbidden session SET");
    if (context === "body") {
      for (const control of ["commit", "rollback", "abort", "savepoint"]) {
        if (values.includes(control)) fail(`Forbidden procedural SQL control: ${control}`);
      }
      if (values.includes("execute")) {
        fail("Forbidden procedural dynamic EXECUTE");
      }
    }

    if (values.includes("execute")) {
      for (const token of current) {
        if (token.kind === "string" || token.kind === "dollar-string") {
          inspect(token.value, "dynamic");
        }
      }
    }
    for (const token of current) {
      if (token.kind === "dollar-string") inspect(token.value, "body");
    }
  }
}

inspect(sql);
NODE
}

input_snapshot_dir="$(mktemp -d "${TMPDIR:-/tmp}/wiseeff-wayfinder671-input.XXXXXX")"
input_snapshot_token="$(new_owner_token)"
initialize_owned_directory "${input_snapshot_dir}" "${input_snapshot_token}"
input_snapshot_identity="$(path_identity "${input_snapshot_dir}")"
input_snapshot_files=(migration.sql validation.sql)
cleanup_input_snapshot_on_exit() {
  local exit_code=$?
  trap - EXIT
  if ! cleanup_owned_directory \
    "${input_snapshot_dir}" "${input_snapshot_identity}" "${input_snapshot_token}" \
    "${input_snapshot_files[@]}"; then
    exit 1
  fi
  exit "${exit_code}"
}
trap cleanup_input_snapshot_on_exit EXIT

if ! snapshot_regular_file "${migration_file}" "${input_snapshot_dir}/migration.sql" \
  || ! snapshot_regular_file "${validation_file}" "${input_snapshot_dir}/validation.sql"; then
  printf '%s\n' 'SQL input must be an absolute stable regular non-symlink file.' >&2
  exit 2
fi
migration_file="${input_snapshot_dir}/migration.sql"
validation_file="${input_snapshot_dir}/validation.sql"

for file in "${migration_file}" "${validation_file}"; do
  if ! validate_sql_input "${file}"; then
    printf 'SQL input contains a forbidden transaction, session, or psql control: %s\n' "$(basename "${file}")" >&2
    exit 2
  fi
  if ! scan_file_for_secrets "${file}" "$(basename "${file}")"; then
    exit 2
  fi
done

if [[ "${check_sql_only}" == "true" ]]; then
  chmod 0500 "${input_snapshot_dir}"
  if ! cleanup_owned_directory \
    "${input_snapshot_dir}" "${input_snapshot_identity}" "${input_snapshot_token}" \
    "${input_snapshot_files[@]}"; then
    exit 1
  fi
  trap - EXIT
  printf '%s\n' 'SQL_INPUT_OK'
  exit 0
fi

if ! snapshot_regular_file \
  "${fixture_verify_file}" "${input_snapshot_dir}/synthetic-fixture-verify.sql"; then
  printf '%s\n' 'Locked fixture verifier must be a stable regular non-symlink file.' >&2
  exit 1
fi
fixture_verify_file="${input_snapshot_dir}/synthetic-fixture-verify.sql"
input_snapshot_files+=(synthetic-fixture-verify.sql)
chmod 0500 "${input_snapshot_dir}"

target_psql() {
  docker exec -i "${container_name}" \
    psql -X -q --no-psqlrc --set=ON_ERROR_STOP=1 \
    -U "${database_user}" -d "${database_name}" "$@"
}

sha256_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

runner_temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/wiseeff-wayfinder671-runner.XXXXXX")"
runner_temp_token="$(new_owner_token)"
initialize_owned_directory "${runner_temp_dir}" "${runner_temp_token}"
runner_temp_identity="$(path_identity "${runner_temp_dir}")"
runner_temp_files=(before.sql before.log after.sql after.log FIXTURE_VERIFY_BEFORE_OK.log FIXTURE_VERIFY_AFTER_ROLLBACK_OK.log candidate.log)
cleanup_runner_on_exit() {
  local exit_code=$?
  trap - EXIT
  local cleanup_failed="false"
  if ! cleanup_owned_directory \
    "${runner_temp_dir}" "${runner_temp_identity}" "${runner_temp_token}" \
    "${runner_temp_files[@]}"; then
    cleanup_failed="true"
  fi
  if ! cleanup_owned_directory \
    "${input_snapshot_dir}" "${input_snapshot_identity}" "${input_snapshot_token}" \
    "${input_snapshot_files[@]}"; then
    cleanup_failed="true"
  fi
  if [[ "${cleanup_failed}" == "true" ]]; then
    exit 1
  fi
  exit "${exit_code}"
}
trap cleanup_runner_on_exit EXIT

canonical_dump_sha256() {
  local label="$1"
  local dump_file="${runner_temp_dir}/${label}.sql"
  local dump_log="${runner_temp_dir}/${label}.log"
  assert_owned_directory \
    "${runner_temp_dir}" "${runner_temp_identity}" "${runner_temp_token}" \
    || return 1
  if ! docker exec -i "${container_name}" \
    pg_dump -U "${database_user}" -d "${database_name}" \
      --no-owner --no-privileges --no-comments --no-security-labels \
      > "${dump_file}" 2> "${dump_log}"; then
    scan_file_for_secrets "${dump_log}" "${label}.log" || true
    printf 'Canonical database dump failed: %s\n' "${label}" >&2
    return 1
  fi
  scan_file_for_secrets "${dump_file}" "${label}.sql"
  scan_file_for_secrets "${dump_log}" "${label}.log"
  sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' "${dump_file}" | sha256_stream
}

run_fixture_verification() {
  local marker="$1"
  local log_file="${runner_temp_dir}/${marker}.log"
  assert_owned_directory \
    "${runner_temp_dir}" "${runner_temp_identity}" "${runner_temp_token}" \
    || return 1
  if ! target_psql < "${fixture_verify_file}" > "${log_file}" 2>&1; then
    scan_file_for_secrets "${log_file}" "${marker}.log" || true
    printf 'Fixture graph verification failed: %s\n' "${marker}" >&2
    return 1
  fi
  scan_file_for_secrets "${log_file}" "${marker}.log"
  printf '%s\n' "${marker}"
}

fixture_relation="$(target_psql -Atc "select to_regclass('wayfinder_rehearsal.fixture_cases')::text")"
if [[ "${fixture_relation}" != "wayfinder_rehearsal.fixture_cases" ]]; then
  printf '%s\n' 'Target database does not contain the Wayfinder #671 fixture registry.' >&2
  exit 1
fi
fixture_mode="$(target_psql -Atc "
  select case when count(*) = 1 then min(value) else '' end
  from wayfinder_rehearsal.manifest
  where key = 'fixture_mode'
")"
case "${fixture_mode}" in
  populated) expected_fixture_cases="10" ;;
  zero) expected_fixture_cases="0" ;;
  *)
    printf '%s\n' 'Target database fixture_mode must be populated or zero.' >&2
    exit 1
    ;;
esac
fixture_cases="$(target_psql -Atc 'select count(*) from wayfinder_rehearsal.fixture_cases')"
if [[ "${fixture_cases}" != "${expected_fixture_cases}" ]]; then
  printf '%s\n' 'Target database fixture registry does not match its declared mode.' >&2
  exit 1
fi

if [[ ! -f "${fixture_verify_file}" || -L "${fixture_verify_file}" ]]; then
  printf '%s\n' 'Locked fixture verifier must be a regular non-symlink file.' >&2
  exit 1
fi
scan_file_for_secrets "${fixture_verify_file}" "synthetic-fixture-verify.sql"
expected_fixture_verify_checksum="$(target_psql -Atc "
  select case when count(*) = 1 then min(value) else '' end
  from wayfinder_rehearsal.manifest
  where key = 'synthetic_fixture_verify_sha256'
")"
actual_fixture_verify_checksum="$(sha256_file "${fixture_verify_file}")"
if [[ "${expected_fixture_verify_checksum}" != "${actual_fixture_verify_checksum}" ]]; then
  printf '%s\n' 'Fixture verifier checksum does not match the imported artifact.' >&2
  exit 1
fi

run_fixture_verification 'FIXTURE_VERIFY_BEFORE_OK'
before_sha256="$(canonical_dump_sha256 before)"

candidate_log="${runner_temp_dir}/candidate.log"
candidate_status=0
assert_owned_directory \
  "${runner_temp_dir}" "${runner_temp_identity}" "${runner_temp_token}"
{
  printf '%s\n' '\set ON_ERROR_STOP on' 'begin;' 'set local search_path = pg_catalog, public;'
  command cat "${migration_file}"
  printf '\n%s\n' '\echo __WISEEFF_WAYFINDER_671_VALIDATION__'
  command cat "${validation_file}"
  printf '\n%s\n' '\echo __WISEEFF_WAYFINDER_671_FIXTURE_VERIFY_AFTER_CANDIDATE__'
  command cat "${fixture_verify_file}"
  printf '\n%s\n' 'rollback;'
} | target_psql > "${candidate_log}" 2>&1 || candidate_status=$?
if ! scan_file_for_secrets "${candidate_log}" "candidate.log"; then
  exit 1
fi
if [[ "${candidate_status}" != "0" ]]; then
  printf '%s\n' 'Candidate migration, validation, or fixture verification failed.' >&2
  exit "${candidate_status}"
fi
if ! grep -q '^__WISEEFF_WAYFINDER_671_FIXTURE_VERIFY_AFTER_CANDIDATE__$' "${candidate_log}"; then
  printf '%s\n' 'Candidate session did not reach the post-validation fixture verification.' >&2
  exit 1
fi
printf '%s\n' 'FIXTURE_VERIFY_AFTER_CANDIDATE_OK'

run_fixture_verification 'FIXTURE_VERIFY_AFTER_ROLLBACK_OK'
after_sha256="$(canonical_dump_sha256 after)"
if [[ "${before_sha256}" != "${after_sha256}" ]]; then
  printf '%s\n' 'Rollback verification failed: canonical database dump changed.' >&2
  printf 'before_sha256=%s\nafter_sha256=%s\n' "${before_sha256}" "${after_sha256}" >&2
  exit 1
fi

if ! cleanup_owned_directory \
  "${runner_temp_dir}" "${runner_temp_identity}" "${runner_temp_token}" \
  "${runner_temp_files[@]}"; then
  exit 1
fi
if ! cleanup_owned_directory \
  "${input_snapshot_dir}" "${input_snapshot_identity}" "${input_snapshot_token}" \
  "${input_snapshot_files[@]}"; then
  exit 1
fi
trap - EXIT

printf '%s\n' \
  'REHEARSAL_ROLLBACK_OK' \
  "target_database=${database_name}" \
  "before_sha256=${before_sha256}" \
  "after_sha256=${after_sha256}" \
  "fixture_mode=${fixture_mode}" \
  "fixture_cases=${fixture_cases}" \
  'CLEANUP_OK'
