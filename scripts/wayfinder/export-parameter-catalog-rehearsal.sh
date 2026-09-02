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
historical_source_commit="6c3adfc35c0e3be6d5d381013dace9408190380e"
historical_bundle_sha256="017b3e614f1f4eba5a70f0c6b0cd3316b7e5ebd1aa9ccec4cf8e514c56dba7ff"
secret_pattern='postgres(ql)?://[^[:space:]]+:[^[:space:]@]+@|bearer[[:space:]]+[A-Za-z0-9._-]{16,}|BEGIN[[:space:]]+[^[:space:]]*[[:space:]]*PRIVATE[[:space:]]+KEY|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}'
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

archive_path="${output_dir}.tar.gz"
archive_checksum_path="${archive_path}.sha256"
stage_dir="$(mktemp -d "${output_dir}.tmp.XXXXXX")"
on_exit() {
  local exit_code=$?
  if [[ "${exit_code}" == "0" ]]; then
    return
  fi
  trap - EXIT
  local cleanup_failed="false"
  set +e
  for owned_path in "${stage_dir}" "${output_dir}" "${archive_path}" "${archive_checksum_path}"; do
    if [[ -e "${owned_path}" || -L "${owned_path}" ]]; then
      rm -rf -- "${owned_path}"
    fi
    if [[ -e "${owned_path}" || -L "${owned_path}" ]]; then
      cleanup_failed="true"
    fi
  done
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
rm "${combined_output}"

db_dump_schema \
  --schema-only \
  --no-owner \
  --no-privileges \
  --no-comments \
  --no-security-labels \
  > "${stage_dir}/schema.sql"

db_psql < "${sql_dir}/migration-inventory.sql" > "${stage_dir}/migration-inventory-after-schema.csv"
scan_file_for_secrets "${stage_dir}/migration-inventory-after-schema.csv" "migration-inventory-after-schema.csv"
if ! cmp -s "${stage_dir}/migration-inventory.csv" "${stage_dir}/migration-inventory-after-schema.csv"; then
  printf '%s\n' 'Migration inventory changed while the schema dump was captured; retry outside a deployment window.' >&2
  exit 1
fi
rm "${stage_dir}/migration-inventory-after-schema.csv"

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

{
  printf 'key,value\n'
  printf 'format_version,2\n'
  printf 'artifact_kind,parameter-catalog-populated-rehearsal-fixture\n'
  printf 'data_rows_exported,0\n'
  printf 'source_data_rows_exported,0\n'
  printf 'synthetic_fixture_version,1\n'
  printf 'import_populates_synthetic_rows,true\n'
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

(
  cd "${stage_dir}"
  for file in *.csv *.sql; do
    [[ "${file}" == "SHA256SUMS" ]] && continue
    printf '%s  %s\n' "$(sha256_file "${file}")" "${file}"
  done | sort -k2
) > "${stage_dir}/SHA256SUMS"

mv "${stage_dir}" "${output_dir}"

tar -czf "${archive_path}" -C "${output_parent}" "$(basename "${output_dir}")"
archive_checksum="$(sha256_file "${archive_path}")"
printf '%s  %s\n' "${archive_checksum}" "$(basename "${archive_path}")" > "${archive_checksum_path}"
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
  'data_rows_exported=0' \
  'source_data_rows_exported=0' \
  'database_identity=withheld'
