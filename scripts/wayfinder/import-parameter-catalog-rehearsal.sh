#!/usr/bin/env bash
set -euo pipefail

umask 077
export LC_ALL=C

container_name=""
database_name=""
database_user="wiseeff"
archive_path=""
expected_archive_sha256=""
validate_artifact_only="false"

usage() {
  printf '%s\n' \
    'Usage: import-parameter-catalog-rehearsal.sh --container NAME --database wiseeff_wayfinder671_restore_SUFFIX --archive ABSOLUTE_PATH --expected-archive-sha256 HEX [--user NAME]' \
    '       import-parameter-catalog-rehearsal.sh --validate-artifact-only --archive ABSOLUTE_PATH --expected-archive-sha256 HEX'
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
    --archive)
      archive_path="${2:?missing value for --archive}"
      shift 2
      ;;
    --expected-archive-sha256)
      expected_archive_sha256="${2:?missing value for --expected-archive-sha256}"
      shift 2
      ;;
    --validate-artifact-only)
      validate_artifact_only="true"
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

if [[ -z "${archive_path}" \
   || ( "${validate_artifact_only}" != "true" \
        && ( -z "${container_name}" || -z "${database_name}" ) ) ]]; then
  usage >&2
  exit 2
fi

if [[ "${validate_artifact_only}" != "true" \
   && ! "${database_name}" =~ ^wiseeff_wayfinder671_restore_[a-z0-9_]+$ ]]; then
  printf '%s\n' 'Target database must use the dedicated wiseeff_wayfinder671_restore_ prefix.' >&2
  exit 2
fi

if [[ -z "${expected_archive_sha256}" ]]; then
  printf '%s\n' '--expected-archive-sha256 is required.' >&2
  exit 2
fi

if [[ ! "${expected_archive_sha256}" =~ ^[0-9a-f]{64}$ ]]; then
  printf '%s\n' '--expected-archive-sha256 must be a lowercase SHA-256 digest.' >&2
  exit 2
fi

if [[ ! "${database_user}" =~ ^[A-Za-z0-9_]+$ || "${archive_path}" != /* \
   || ! -f "${archive_path}" || -L "${archive_path}" ]]; then
  printf '%s\n' 'User must be a simple identifier and archive must be an existing absolute regular file.' >&2
  exit 2
fi

checksum_files=(
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

is_checksum_file() {
  local candidate="$1"
  local required
  for required in "${checksum_files[@]}"; do
    if [[ "${candidate}" == "${required}" ]]; then
      return 0
    fi
  done
  return 1
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
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

snapshot_archive_file() {
  local source_path="$1"
  local destination_path="$2"
  node --input-type=module - "${source_path}" "${destination_path}" <<'NODE'
import fs from "node:fs";
const [sourcePath, destinationPath] = process.argv.slice(2);
let sourceFd;
let destinationFd;
try {
  sourceFd = fs.openSync(
    sourcePath,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
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
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
      | fs.constants.O_NOFOLLOW,
    0o400,
  );
  fs.writeFileSync(destinationFd, bytes);
  fs.fsyncSync(destinationFd);
} catch {
  process.exit(1);
} finally {
  if (sourceFd !== undefined) fs.closeSync(sourceFd);
  if (destinationFd !== undefined) fs.closeSync(destinationFd);
}
NODE
}

artifact_snapshot_dir="$(mktemp -d "${TMPDIR:-/tmp}/wiseeff-wayfinder671-import-input.XXXXXX")"
artifact_snapshot_token="$(new_owner_token)"
initialize_owned_directory "${artifact_snapshot_dir}" "${artifact_snapshot_token}"
artifact_snapshot_identity="$(path_identity "${artifact_snapshot_dir}")"
snapshot_archive_path="${artifact_snapshot_dir}/artifact.tar.gz"
artifact_snapshot_files=(artifact.tar.gz SHA256SUMS "${checksum_files[@]}")
cleanup_artifact_snapshot_on_exit() {
  local exit_code=$?
  trap - EXIT
  if ! cleanup_owned_directory \
    "${artifact_snapshot_dir}" "${artifact_snapshot_identity}" "${artifact_snapshot_token}" \
    "${artifact_snapshot_files[@]}"; then
    exit 1
  fi
  exit "${exit_code}"
}
trap cleanup_artifact_snapshot_on_exit EXIT

if ! snapshot_archive_file "${archive_path}" "${snapshot_archive_path}"; then
  printf '%s\n' 'Artifact archive changed or is not a stable regular file.' >&2
  exit 1
fi
if [[ "$(sha256_file "${snapshot_archive_path}")" != "${expected_archive_sha256}" ]]; then
  printf '%s\n' 'Artifact archive digest does not match the externally trusted digest.' >&2
  exit 1
fi

archive_members="$(tar -tzf "${snapshot_archive_path}" --)"
archive_root="$(printf '%s\n' "${archive_members}" | awk -F/ 'NR == 1 { print $1 }')"
if [[ ! "${archive_root}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  printf '%s\n' 'Artifact archive root name is unsafe.' >&2
  exit 1
fi
expected_members=""
for file in SHA256SUMS "${checksum_files[@]}"; do
  expected_members+="${archive_root}/${file}"$'\n'
done
if [[ "$(printf '%s\n' "${archive_members}" | LC_ALL=C sort)" \
   != "$(printf '%s' "${expected_members}" | LC_ALL=C sort)" ]]; then
  unexpected_member="$(comm -23 \
    <(printf '%s\n' "${archive_members}" | LC_ALL=C sort) \
    <(printf '%s' "${expected_members}" | LC_ALL=C sort) | head -n 1)"
  missing_member="$(comm -13 \
    <(printf '%s\n' "${archive_members}" | LC_ALL=C sort) \
    <(printf '%s' "${expected_members}" | LC_ALL=C sort) | head -n 1)"
  if [[ -n "${unexpected_member}" ]]; then
    unexpected_name="${unexpected_member#*/}"
    printf 'Unknown artifact entry: %s\n' "${unexpected_name%/}" >&2
  fi
  if [[ -n "${missing_member}" ]]; then
    printf 'Required artifact file is missing: %s\n' "${missing_member#*/}" >&2
  fi
  printf '%s\n' 'Artifact archive does not contain the exact allowed member set.' >&2
  exit 1
fi
if ! tar -xzf "${snapshot_archive_path}" -C "${artifact_snapshot_dir}" \
  --strip-components=1 --no-same-owner --no-same-permissions --; then
  printf '%s\n' 'Artifact archive extraction failed.' >&2
  exit 1
fi
chmod 0500 "${artifact_snapshot_dir}"
artifact_dir="${artifact_snapshot_dir}"

for file in SHA256SUMS "${checksum_files[@]}"; do
  if [[ ! -f "${artifact_dir}/${file}" || -L "${artifact_dir}/${file}" ]]; then
    printf 'Required artifact file is missing: %s\n' "${file}" >&2
    exit 1
  fi
done
for file in schema.sql profile-schema.sql synthetic-fixture.sql synthetic-fixture-verify.sql; do
  if LC_ALL=C grep -anE '^[[:space:]]*\\' "${artifact_dir}/${file}" >/dev/null; then
    printf 'Unsafe psql meta-command detected in %s.\n' "${file}" >&2
    exit 1
  fi
done

while IFS= read -r -d '' entry; do
  file="$(basename "${entry}")"
  if [[ "${file}" == ".wiseeff-owner" || "${file}" == "artifact.tar.gz" ]]; then
    continue
  fi
  if [[ "${file}" != "SHA256SUMS" ]] && ! is_checksum_file "${file}"; then
    printf 'Unknown artifact entry: %s\n' "${file}" >&2
    exit 1
  fi
  if [[ ! -f "${entry}" || -L "${entry}" ]]; then
    printf 'Artifact entry must be a regular non-symlink file: %s\n' "${file}" >&2
    exit 1
  fi
done < <(find "${artifact_dir}" -mindepth 1 -maxdepth 1 -print0)

seen_files=$'\n'
while IFS= read -r line || [[ -n "${line}" ]]; do
  if [[ ! "${line}" =~ ^([0-9a-f]{64})\ \ ([A-Za-z0-9][A-Za-z0-9._-]*)$ ]]; then
    printf 'Unsafe or malformed SHA256SUMS entry: %s\n' "${line}" >&2
    exit 1
  fi
  expected="${BASH_REMATCH[1]}"
  file="${BASH_REMATCH[2]}"
  if ! is_checksum_file "${file}"; then
    printf 'Unknown checksum entry: %s\n' "${file}" >&2
    exit 1
  fi
  if [[ "${seen_files}" == *$'\n'"${file}"$'\n'* ]]; then
    printf 'Duplicate checksum entry: %s\n' "${file}" >&2
    exit 1
  fi
  actual="$(sha256_file "${artifact_dir}/${file}")"
  if [[ "${actual}" != "${expected}" ]]; then
    printf 'Checksum mismatch: %s\n' "${file}" >&2
    exit 1
  fi
  seen_files+="${file}"$'\n'
done < "${artifact_dir}/SHA256SUMS"

for file in "${checksum_files[@]}"; do
  if [[ "${seen_files}" != *$'\n'"${file}"$'\n'* ]]; then
    printf 'Checksum entry is missing: %s\n' "${file}" >&2
    exit 1
  fi
done

secret_pattern='postgres(ql)?://[^[:space:]]+:[^[:space:]@]+@|password[[:space:]]*(=|=>)[[:space:]]*[^[:space:],;)]{3,}|password[[:space:]]+[^[:space:],;)]{3,}|PGPASSWORD[[:space:]]*=|(access[_-]?token|api[_-]?key|client[_-]?secret|secret|token)[[:space:]]*(=|=>)[[:space:]]*[^[:space:],;)]{8,}|bearer[[:space:]]+[A-Za-z0-9._-]{16,}|BEGIN[[:space:]]+[^[:space:]]*[[:space:]]*PRIVATE[[:space:]]+KEY|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}'
for file in SHA256SUMS "${checksum_files[@]}"; do
  if LC_ALL=C grep -aEiq "${secret_pattern}" "${artifact_dir}/${file}"; then
    printf 'Sensitive-token pattern detected in %s.\n' "${file}" >&2
    exit 1
  fi
done

manifest_value() {
  local key="$1"
  awk -F, -v key="${key}" '
    NR == 1 { next }
    $1 == key { count += 1; value = $2 }
    END {
      if (count != 1) exit 1
      print value
    }
  ' "${artifact_dir}/manifest.csv"
}

format_version="$(manifest_value format_version || true)"
artifact_kind="$(manifest_value artifact_kind || true)"
fixture_mode="$(manifest_value fixture_mode || true)"
data_rows_exported_manifest="$(manifest_value data_rows_exported || true)"
source_data_rows_exported="$(manifest_value source_data_rows_exported || true)"
synthetic_fixture_version="$(manifest_value synthetic_fixture_version || true)"
import_populates_synthetic_rows="$(manifest_value import_populates_synthetic_rows || true)"
historical_source_commit="$(manifest_value historical_source_commit || true)"
historical_bundle_sha256="$(manifest_value historical_bundle_sha256 || true)"
synthetic_fixture_verify_sha256="$(manifest_value synthetic_fixture_verify_sha256 || true)"
if [[ "${format_version}" != "2" \
   || "${data_rows_exported_manifest}" != "0" \
   || "${source_data_rows_exported}" != "0" \
   || "${synthetic_fixture_version}" != "1" \
   || "${historical_source_commit}" != "6c3adfc35c0e3be6d5d381013dace9408190380e" \
   || "${historical_bundle_sha256}" != "017b3e614f1f4eba5a70f0c6b0cd3316b7e5ebd1aa9ccec4cf8e514c56dba7ff" \
   || ! "${synthetic_fixture_verify_sha256}" =~ ^[0-9a-f]{64}$ ]]; then
  printf '%s\n' 'Artifact manifest does not describe a supported rehearsal fixture.' >&2
  exit 1
fi
case "${fixture_mode}" in
  populated)
    if [[ "${artifact_kind}" != "parameter-catalog-populated-rehearsal-fixture" \
       || "${import_populates_synthetic_rows}" != "true" ]]; then
      printf '%s\n' 'Populated fixture manifest mode and import policy disagree.' >&2
      exit 1
    fi
    ;;
  zero)
    if [[ "${artifact_kind}" != "parameter-catalog-zero-rehearsal-fixture" \
       || "${import_populates_synthetic_rows}" != "false" ]]; then
      printf '%s\n' 'Zero fixture manifest mode and import policy disagree.' >&2
      exit 1
    fi
    ;;
  *)
    printf '%s\n' 'Artifact manifest fixture_mode must be populated or zero.' >&2
    exit 1
    ;;
esac
expected_fixture_cases="0"
if [[ "${fixture_mode}" == "populated" ]]; then
  expected_fixture_cases="10"
fi
if [[ "$(sha256_file "${artifact_dir}/synthetic-fixture-verify.sql")" \
   != "${synthetic_fixture_verify_sha256}" ]]; then
  printf '%s\n' 'Artifact manifest verifier checksum does not match synthetic-fixture-verify.sql.' >&2
  exit 1
fi

if [[ "${validate_artifact_only}" == "true" ]]; then
  if ! cleanup_owned_directory \
    "${artifact_snapshot_dir}" "${artifact_snapshot_identity}" "${artifact_snapshot_token}" \
    "${artifact_snapshot_files[@]}"; then
    exit 1
  fi
  trap - EXIT
  printf '%s\n' 'ARTIFACT_OK'
  exit 0
fi

database_exists="$(docker exec -i "${container_name}" psql -X -q --no-psqlrc -At \
  -U "${database_user}" -d postgres \
  -c "select count(*) from pg_database where datname = '${database_name}'")"
if [[ "${database_exists}" != "1" ]]; then
  printf '%s\n' 'Target database must already exist; this script never creates or drops databases.' >&2
  exit 1
fi

target_user_object_count() {
  docker exec -i "${container_name}" psql -X -q --no-psqlrc -At \
    -U "${database_user}" -d "${database_name}" \
    -c "with user_namespaces as (
        select oid
        from pg_namespace
        where nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
          and nspname !~ '^pg_(temp|toast_temp)_'
      ), object_counts(value) as (
        values
          ((select count(*) from pg_namespace where oid in (select oid from user_namespaces) and nspname <> 'public')),
          ((select count(*) from pg_class where relnamespace in (select oid from user_namespaces))),
          ((select count(*) from pg_proc where pronamespace in (select oid from user_namespaces))),
          ((select count(*) from pg_type where typnamespace in (select oid from user_namespaces))),
          ((select count(*) from pg_operator where oprnamespace in (select oid from user_namespaces))),
          ((select count(*) from pg_collation where collnamespace in (select oid from user_namespaces))),
          ((select count(*) from pg_conversion where connamespace in (select oid from user_namespaces))),
          ((select count(*) from pg_ts_config where cfgnamespace in (select oid from user_namespaces))),
          ((select count(*) from pg_ts_dict where dictnamespace in (select oid from user_namespaces))),
          ((select count(*) from pg_ts_parser where prsnamespace in (select oid from user_namespaces))),
          ((select count(*) from pg_ts_template where tmplnamespace in (select oid from user_namespaces))),
          ((select count(*) from pg_extension where extname <> 'plpgsql')),
          ((select count(*) from pg_language where lanname not in ('internal', 'c', 'sql', 'plpgsql'))),
          ((select count(*) from pg_largeobject_metadata)),
          ((select count(*) from pg_event_trigger)),
          ((select count(*) from pg_publication)),
          ((select count(*) from pg_foreign_server))
      )
      select coalesce(sum(value), 0) from object_counts"
}

if [[ "$(target_user_object_count)" != "0" ]]; then
  printf '%s\n' 'Target database contains user-defined objects; refusing to overwrite or merge.' >&2
  exit 1
fi

target_psql() {
  docker exec -i "${container_name}" \
    psql -X -q --no-psqlrc --set=ON_ERROR_STOP=1 \
    -U "${database_user}" -d "${database_name}" "$@"
}

import_temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/wiseeff-wayfinder671-import.XXXXXX")"
import_temp_token="$(new_owner_token)"
initialize_owned_directory "${import_temp_dir}" "${import_temp_token}"
import_temp_identity="$(path_identity "${import_temp_dir}")"
import_log="${import_temp_dir}/import.log"
import_committed="false"

reset_target_to_checked_empty() {
  target_psql <<'SQL'
begin;
do $wayfinder_cleanup$
declare item record;
begin
  for item in
    select evtname as name from pg_event_trigger
  loop
    execute format('drop event trigger %I', item.name);
  end loop;
  for item in
    select pubname as name from pg_publication
  loop
    execute format('drop publication %I', item.name);
  end loop;
  for item in
    select srvname as name from pg_foreign_server
  loop
    execute format('drop server %I cascade', item.name);
  end loop;
  for item in
    select extname as name from pg_extension where extname <> 'plpgsql'
  loop
    execute format('drop extension %I cascade', item.name);
  end loop;
  for item in
    select nspname as name
    from pg_namespace
    where nspname not in ('pg_catalog', 'information_schema', 'pg_toast', 'public')
      and nspname !~ '^pg_(temp|toast_temp)_'
  loop
    execute format('drop schema %I cascade', item.name);
  end loop;
  drop schema public cascade;
  create schema public authorization current_user;
  perform lo_unlink(oid) from pg_largeobject_metadata;
end
$wayfinder_cleanup$;
commit;
SQL
}

cleanup_import_on_exit() {
  local exit_code=$?
  trap - EXIT
  local cleanup_failed="false"
  if [[ "${exit_code}" != "0" && "${import_committed}" == "true" ]]; then
    if ! reset_target_to_checked_empty \
      || [[ "$(target_user_object_count || true)" != "0" ]]; then
      cleanup_failed="true"
    fi
  fi
  if ! cleanup_owned_directory \
    "${import_temp_dir}" "${import_temp_identity}" "${import_temp_token}" import.log; then
    cleanup_failed="true"
  fi
  if ! cleanup_owned_directory \
    "${artifact_snapshot_dir}" "${artifact_snapshot_identity}" "${artifact_snapshot_token}" \
    "${artifact_snapshot_files[@]}"; then
    cleanup_failed="true"
  fi
  if [[ "${cleanup_failed}" == "true" ]]; then
    printf '%s\n' 'CLEANUP_FAILED' >&2
    exit 1
  fi
  exit "${exit_code}"
}
trap cleanup_import_on_exit EXIT

import_status=0
{
  printf '%s\n' '\set ON_ERROR_STOP on' 'begin;'
  command cat "${artifact_dir}/schema.sql"
  printf '%s\n' 'set local search_path = public, pg_catalog;'
  command cat "${artifact_dir}/profile-schema.sql"
  for table in relations columns constraints indexes triggers migration_inventory row_counts row_classes invariant_counts manifest; do
    file="${table//_/-}.csv"
    if [[ "${table}" == "migration_inventory" ]]; then file="migration-inventory.csv"; fi
    if [[ "${table}" == "row_counts" ]]; then file="row-counts.csv"; fi
    if [[ "${table}" == "row_classes" ]]; then file="row-classes.csv"; fi
    if [[ "${table}" == "invariant_counts" ]]; then file="invariant-counts.csv"; fi
    printf '%s\n' "\\copy wayfinder_rehearsal.${table} from stdin with (format csv, header true)"
    command cat "${artifact_dir}/${file}"
    printf '%s\n' '\.'
  done
  printf '%s\n' \
    "insert into public.schema_migrations (name, applied_at, checksum)" \
    "select name, '2026-01-01T00:00:00Z'::timestamptz, checksum" \
    "from wayfinder_rehearsal.migration_inventory order by name;"
  if [[ "${fixture_mode}" == "populated" ]]; then
    command cat "${artifact_dir}/synthetic-fixture.sql"
  fi
  command cat "${artifact_dir}/synthetic-fixture-verify.sql"
  cat <<SQL
do \$wayfinder_import_verify\$
declare
  restored_public_relations bigint;
  profile_rows bigint;
  data_rows_exported text;
  fixture_cases bigint;
  migration_ledger_rows bigint;
begin
  select count(*) into restored_public_relations
  from pg_class c
  inner join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm');
  select
    (select count(*) from wayfinder_rehearsal.row_counts)
    + (select count(*) from wayfinder_rehearsal.row_classes)
    + (select count(*) from wayfinder_rehearsal.invariant_counts)
  into profile_rows;
  select value into data_rows_exported
  from wayfinder_rehearsal.manifest where key = 'data_rows_exported';
  select count(*) into fixture_cases from wayfinder_rehearsal.fixture_cases;
  select count(*) into migration_ledger_rows from schema_migrations;
  if restored_public_relations = 0
     or profile_rows = 0
     or data_rows_exported <> '0'
     or fixture_cases <> ${expected_fixture_cases:-0} then
    raise exception 'Imported rehearsal failed structural/profile verification';
  end if;
end
\$wayfinder_import_verify\$;
\pset format unaligned
\pset tuples_only on
select '__WISEEFF_IMPORT_METRICS__|'
  || (select count(*) from pg_class c inner join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm'))
  || '|'
  || ((select count(*) from wayfinder_rehearsal.row_counts)
      + (select count(*) from wayfinder_rehearsal.row_classes)
      + (select count(*) from wayfinder_rehearsal.invariant_counts))
  || '|'
  || (select count(*) from wayfinder_rehearsal.fixture_cases)
  || '|'
  || (select count(*) from schema_migrations);
SQL
  printf '%s\n' 'commit;'
} | target_psql > "${import_log}" 2>&1 || import_status=$?

if [[ "${import_status}" == "0" ]]; then
  import_committed="true"
fi
if LC_ALL=C grep -aEiq "${secret_pattern}" "${import_log}"; then
  printf '%s\n' 'Sensitive-token pattern detected in import.log.' >&2
  import_status=1
fi
if [[ "${import_status}" != "0" ]]; then
  remaining_objects="$(target_user_object_count || true)"
  printf '%s\n' 'IMPORT_FAILED' >&2
  if [[ "${remaining_objects}" != "0" ]]; then
    printf '%s\n' 'CLEANUP_FAILED' >&2
    exit 1
  fi
  if ! cleanup_owned_directory \
    "${import_temp_dir}" "${import_temp_identity}" "${import_temp_token}" import.log \
    || ! cleanup_owned_directory \
      "${artifact_snapshot_dir}" "${artifact_snapshot_identity}" "${artifact_snapshot_token}" \
      "${artifact_snapshot_files[@]}"; then
    exit 1
  fi
  trap - EXIT
  printf '%s\n' 'CLEANUP_OK' >&2
  exit "${import_status}"
fi

if [[ "$(grep -c '__WISEEFF_IMPORT_METRICS__|' "${import_log}")" != "1" ]]; then
  printf '%s\n' 'Imported rehearsal failed structural/profile verification.' >&2
  exit 1
fi
metrics_line="$(grep '__WISEEFF_IMPORT_METRICS__|' "${import_log}" | tail -n 1)"
metrics="${metrics_line#*__WISEEFF_IMPORT_METRICS__|}"
IFS='|' read -r restored_public_relations profile_rows fixture_cases migration_ledger_rows <<< "${metrics}"
for value in \
  "${restored_public_relations}" "${profile_rows}" "${fixture_cases}" "${migration_ledger_rows}"; do
  if [[ ! "${value}" =~ ^[0-9]+$ ]]; then
    printf '%s\n' 'Imported rehearsal emitted malformed structural metrics.' >&2
    exit 1
  fi
done

if ! cleanup_owned_directory \
  "${import_temp_dir}" "${import_temp_identity}" "${import_temp_token}" import.log \
  || ! cleanup_owned_directory \
    "${artifact_snapshot_dir}" "${artifact_snapshot_identity}" "${artifact_snapshot_token}" \
    "${artifact_snapshot_files[@]}"; then
  if ! reset_target_to_checked_empty \
    || [[ "$(target_user_object_count || true)" != "0" ]]; then
    printf '%s\n' 'CLEANUP_FAILED' >&2
  fi
  exit 1
fi
trap - EXIT

printf '%s\n' \
  'IMPORT_OK' \
  "target_database=${database_name}" \
  "restored_public_relations=${restored_public_relations}" \
  "loaded_profile_rows=${profile_rows}" \
  "loaded_fixture_cases=${fixture_cases}" \
  "loaded_migration_ledger_rows=${migration_ledger_rows}" \
  "fixture_mode=${fixture_mode}" \
  'data_rows_exported=0' \
  'source_data_rows_exported=0'
