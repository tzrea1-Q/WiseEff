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

usage() {
  printf '%s\n' \
    'Usage:' \
    '  export-parameter-catalog-rehearsal.sh --output-dir ABSOLUTE_PATH --container NAME [--database NAME] [--user NAME]' \
    '  export-parameter-catalog-rehearsal.sh --output-dir ABSOLUTE_PATH --compose-file FILE --env-file FILE [--database NAME] [--user NAME]'
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

required_migration="0136_parameter_execution_principal_deleted_marker.sql"
if [[ "$(db_psql -Atc "select count(*) from schema_migrations where name = '${required_migration}'")" != "1" ]]; then
  printf 'Required migration is not applied: %s\n' "${required_migration}" >&2
  exit 1
fi

stage_dir="$(mktemp -d "${output_dir}.tmp.XXXXXX")"
on_error() {
  local exit_code=$?
  printf 'EXPORT_FAILED\nstaging_dir_retained=%s\n' "${stage_dir}" >&2
  exit "${exit_code}"
}
trap on_error ERR

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
rm "${combined_output}"

db_dump_schema \
  --schema-only \
  --no-owner \
  --no-privileges \
  --no-comments \
  --no-security-labels \
  > "${stage_dir}/schema.sql"

db_psql < "${sql_dir}/migration-inventory.sql" > "${stage_dir}/migration-inventory-after-schema.csv"
if ! cmp -s "${stage_dir}/migration-inventory.csv" "${stage_dir}/migration-inventory-after-schema.csv"; then
  printf '%s\n' 'Migration inventory changed while the schema dump was captured; retry outside a deployment window.' >&2
  exit 1
fi
rm "${stage_dir}/migration-inventory-after-schema.csv"

cp "${sql_dir}/profile-schema.sql" "${stage_dir}/profile-schema.sql"

if grep -Eq '^COPY public\.|^INSERT INTO public\.' "${stage_dir}/schema.sql"; then
  printf '%s\n' 'Schema dump unexpectedly contains public data statements.' >&2
  exit 1
fi

for safe_profile in migration-inventory.csv row-counts.csv row-classes.csv invariant-counts.csv; do
  if grep -Eiq 'postgres(ql)?://|bearer[[:space:]]+[A-Za-z0-9._-]+|BEGIN[[:space:]]+[^[:space:]]*[[:space:]]*PRIVATE[[:space:]]+KEY|AKIA[0-9A-Z]{16}|\$2[aby]\$' "${stage_dir}/${safe_profile}"; then
    printf 'Sensitive-token pattern detected in %s.\n' "${safe_profile}" >&2
    exit 1
  fi
done

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
schema_dump_canonical_checksum="$(
  sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' "${stage_dir}/schema.sql" | sha256_stream
)"
migration_count="$(awk 'END { print NR - 1 }' "${stage_dir}/migration-inventory.csv")"
last_migration="$(tail -n 1 "${stage_dir}/migration-inventory.csv" | cut -d, -f1)"
server_version_num="$(db_psql -Atc "select current_setting('server_version_num')")"
export_commit="$(git -C "${repo_root}" rev-parse HEAD)"
exported_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

{
  printf 'key,value\n'
  printf 'format_version,1\n'
  printf 'artifact_kind,parameter-catalog-structural-rehearsal-profile\n'
  printf 'data_rows_exported,0\n'
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
  printf 'sanitization_contract,structure-and-aggregate-classes-only\n'
} > "${stage_dir}/manifest.csv"

(
  cd "${stage_dir}"
  for file in *.csv *.sql; do
    [[ "${file}" == "SHA256SUMS" ]] && continue
    printf '%s  %s\n' "$(sha256_file "${file}")" "${file}"
  done | sort -k2
) > "${stage_dir}/SHA256SUMS"

mv "${stage_dir}" "${output_dir}"
trap - ERR

archive_path="${output_dir}.tar.gz"
tar -czf "${archive_path}" -C "${output_parent}" "$(basename "${output_dir}")"
archive_checksum="$(sha256_file "${archive_path}")"
printf '%s  %s\n' "${archive_checksum}" "$(basename "${archive_path}")" > "${archive_path}.sha256"

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
  'data_rows_exported=0' \
  'database_identity=withheld'
