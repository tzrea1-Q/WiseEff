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

required_files=(
  SHA256SUMS
  schema.sql
  profile-schema.sql
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

for file in "${required_files[@]}"; do
  if [[ ! -f "${artifact_dir}/${file}" ]]; then
    printf 'Required artifact file is missing: %s\n' "${file}" >&2
    exit 1
  fi
done

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

while read -r expected file; do
  actual="$(sha256_file "${artifact_dir}/${file}")"
  if [[ "${actual}" != "${expected}" ]]; then
    printf 'Checksum mismatch: %s\n' "${file}" >&2
    exit 1
  fi
done < "${artifact_dir}/SHA256SUMS"

database_exists="$(docker exec -i "${container_name}" psql -X -q --no-psqlrc -At \
  -U "${database_user}" -d postgres \
  -c "select count(*) from pg_database where datname = '${database_name}'")"
if [[ "${database_exists}" != "1" ]]; then
  printf '%s\n' 'Target database must already exist; this script never creates or drops databases.' >&2
  exit 1
fi

target_table_count="$(docker exec -i "${container_name}" psql -X -q --no-psqlrc -At \
  -U "${database_user}" -d "${database_name}" \
  -c "select count(*) from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema')")"
if [[ "${target_table_count}" != "0" ]]; then
  printf '%s\n' 'Target database is not empty; refusing to overwrite or merge.' >&2
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

restored_public_relations="$(target_psql -Atc "select count(*) from pg_class c inner join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m')")"
profile_rows="$(target_psql -Atc "select (select count(*) from wayfinder_rehearsal.row_counts) + (select count(*) from wayfinder_rehearsal.row_classes) + (select count(*) from wayfinder_rehearsal.invariant_counts)")"
data_rows_exported="$(target_psql -Atc "select value from wayfinder_rehearsal.manifest where key='data_rows_exported'")"

if [[ "${restored_public_relations}" == "0" || "${profile_rows}" == "0" || "${data_rows_exported}" != "0" ]]; then
  printf '%s\n' 'Imported rehearsal failed structural/profile verification.' >&2
  exit 1
fi

printf '%s\n' \
  'IMPORT_OK' \
  "target_database=${database_name}" \
  "restored_public_relations=${restored_public_relations}" \
  "loaded_profile_rows=${profile_rows}" \
  'data_rows_exported=0'
