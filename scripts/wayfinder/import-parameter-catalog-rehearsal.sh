#!/usr/bin/env bash
set -euo pipefail

umask 077
export LC_ALL=C

container_name=""
database_name=""
database_user="wiseeff"
artifact_dir=""

usage() {
  printf '%s\n' \
    'Usage: import-parameter-catalog-rehearsal.sh --container NAME --database wiseeff_wayfinder671_restore_SUFFIX --artifact-dir ABSOLUTE_PATH [--user NAME]'
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
    --artifact-dir)
      artifact_dir="${2:?missing value for --artifact-dir}"
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

if [[ -z "${container_name}" || -z "${database_name}" || -z "${artifact_dir}" ]]; then
  usage >&2
  exit 2
fi

if [[ ! "${database_name}" =~ ^wiseeff_wayfinder671_restore_[a-z0-9_]+$ ]]; then
  printf '%s\n' 'Target database must use the dedicated wiseeff_wayfinder671_restore_ prefix.' >&2
  exit 2
fi

if [[ ! "${database_user}" =~ ^[A-Za-z0-9_]+$ || "${artifact_dir}" != /* || ! -d "${artifact_dir}" ]]; then
  printf '%s\n' 'User must be a simple identifier and artifact directory must be an existing absolute path.' >&2
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

for file in SHA256SUMS "${checksum_files[@]}"; do
  if [[ ! -f "${artifact_dir}/${file}" || -L "${artifact_dir}/${file}" ]]; then
    printf 'Required artifact file is missing: %s\n' "${file}" >&2
    exit 1
  fi
done

while IFS= read -r -d '' entry; do
  file="$(basename "${entry}")"
  if [[ "${file}" != "SHA256SUMS" ]] && ! is_checksum_file "${file}"; then
    printf 'Unknown artifact entry: %s\n' "${file}" >&2
    exit 1
  fi
  if [[ ! -f "${entry}" || -L "${entry}" ]]; then
    printf 'Artifact entry must be a regular non-symlink file: %s\n' "${file}" >&2
    exit 1
  fi
done < <(find "${artifact_dir}" -mindepth 1 -maxdepth 1 -print0)

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

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
data_rows_exported_manifest="$(manifest_value data_rows_exported || true)"
source_data_rows_exported="$(manifest_value source_data_rows_exported || true)"
synthetic_fixture_version="$(manifest_value synthetic_fixture_version || true)"
import_populates_synthetic_rows="$(manifest_value import_populates_synthetic_rows || true)"
if [[ "${format_version}" != "2" \
   || "${artifact_kind}" != "parameter-catalog-populated-rehearsal-fixture" \
   || "${data_rows_exported_manifest}" != "0" \
   || "${source_data_rows_exported}" != "0" \
   || "${synthetic_fixture_version}" != "1" \
   || "${import_populates_synthetic_rows}" != "true" ]]; then
  printf '%s\n' 'Artifact manifest does not describe the required populated synthetic fixture.' >&2
  exit 1
fi

database_exists="$(docker exec -i "${container_name}" psql -X -q --no-psqlrc -At \
  -U "${database_user}" -d postgres \
  -c "select count(*) from pg_database where datname = '${database_name}'")"
if [[ "${database_exists}" != "1" ]]; then
  printf '%s\n' 'Target database must already exist; this script never creates or drops databases.' >&2
  exit 1
fi

target_user_object_count="$(docker exec -i "${container_name}" psql -X -q --no-psqlrc -At \
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
      select coalesce(sum(value), 0) from object_counts")"
if [[ "${target_user_object_count}" != "0" ]]; then
  printf '%s\n' 'Target database contains user-defined objects; refusing to overwrite or merge.' >&2
  exit 1
fi

target_psql() {
  docker exec -i "${container_name}" \
    psql -X -q --no-psqlrc --set=ON_ERROR_STOP=1 \
    -U "${database_user}" -d "${database_name}" "$@"
}

target_psql < "${artifact_dir}/schema.sql"
target_psql < "${artifact_dir}/profile-schema.sql"

target_psql -c '\copy wayfinder_rehearsal.relations from stdin with (format csv, header true)' < "${artifact_dir}/relations.csv"
target_psql -c '\copy wayfinder_rehearsal.columns from stdin with (format csv, header true)' < "${artifact_dir}/columns.csv"
target_psql -c '\copy wayfinder_rehearsal.constraints from stdin with (format csv, header true)' < "${artifact_dir}/constraints.csv"
target_psql -c '\copy wayfinder_rehearsal.indexes from stdin with (format csv, header true)' < "${artifact_dir}/indexes.csv"
target_psql -c '\copy wayfinder_rehearsal.triggers from stdin with (format csv, header true)' < "${artifact_dir}/triggers.csv"
target_psql -c '\copy wayfinder_rehearsal.migration_inventory from stdin with (format csv, header true)' < "${artifact_dir}/migration-inventory.csv"
target_psql -c '\copy wayfinder_rehearsal.row_counts from stdin with (format csv, header true)' < "${artifact_dir}/row-counts.csv"
target_psql -c '\copy wayfinder_rehearsal.row_classes from stdin with (format csv, header true)' < "${artifact_dir}/row-classes.csv"
target_psql -c '\copy wayfinder_rehearsal.invariant_counts from stdin with (format csv, header true)' < "${artifact_dir}/invariant-counts.csv"
target_psql -c '\copy wayfinder_rehearsal.manifest from stdin with (format csv, header true)' < "${artifact_dir}/manifest.csv"
{
  printf '%s\n' 'begin;'
  printf '%s\n' \
    "insert into schema_migrations (name, applied_at, checksum)" \
    "select name, '2026-01-01T00:00:00Z'::timestamptz, checksum" \
    "from wayfinder_rehearsal.migration_inventory order by name;"
  sed 's/\r$//' "${artifact_dir}/synthetic-fixture.sql"
  sed 's/\r$//' "${artifact_dir}/synthetic-fixture-verify.sql"
  printf '%s\n' 'commit;'
} | target_psql

restored_public_relations="$(target_psql -Atc "select count(*) from pg_class c inner join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m')")"
profile_rows="$(target_psql -Atc "select (select count(*) from wayfinder_rehearsal.row_counts) + (select count(*) from wayfinder_rehearsal.row_classes) + (select count(*) from wayfinder_rehearsal.invariant_counts)")"
data_rows_exported="$(target_psql -Atc "select value from wayfinder_rehearsal.manifest where key='data_rows_exported'")"
fixture_cases="$(target_psql -Atc "select count(*) from wayfinder_rehearsal.fixture_cases")"
migration_ledger_rows="$(target_psql -Atc 'select count(*) from schema_migrations')"

if [[ "${restored_public_relations}" == "0" || "${profile_rows}" == "0" || "${data_rows_exported}" != "0" || "${fixture_cases}" != "10" ]]; then
  printf '%s\n' 'Imported rehearsal failed structural/profile verification.' >&2
  exit 1
fi

printf '%s\n' \
  'IMPORT_OK' \
  "target_database=${database_name}" \
  "restored_public_relations=${restored_public_relations}" \
  "loaded_profile_rows=${profile_rows}" \
  "loaded_fixture_cases=${fixture_cases}" \
  "loaded_migration_ledger_rows=${migration_ledger_rows}" \
  'data_rows_exported=0' \
  'source_data_rows_exported=0'
