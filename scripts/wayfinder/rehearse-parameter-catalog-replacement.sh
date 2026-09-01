#!/usr/bin/env bash
set -euo pipefail

umask 077
export LC_ALL=C

container_name=""
database_name=""
database_user="wiseeff"
migration_file=""
validation_file=""

usage() {
  printf '%s\n' \
    'Usage: rehearse-parameter-catalog-replacement.sh --container NAME --database wiseeff_wayfinder671_restore_SUFFIX --migration-file ABSOLUTE_PATH --validation-file ABSOLUTE_PATH [--user NAME]'
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

if [[ -z "${container_name}" || -z "${database_name}" \
   || -z "${migration_file}" || -z "${validation_file}" ]]; then
  usage >&2
  exit 2
fi

if [[ ! "${database_name}" =~ ^wiseeff_wayfinder671_restore_[a-z0-9_]+$ ]]; then
  printf '%s\n' 'Target database must use the dedicated wiseeff_wayfinder671_restore_ prefix.' >&2
  exit 2
fi

if [[ ! "${database_user}" =~ ^[A-Za-z0-9_]+$ ]]; then
  printf '%s\n' 'Database user must be a simple identifier.' >&2
  exit 2
fi

for file in "${migration_file}" "${validation_file}"; do
  if [[ "${file}" != /* || ! -f "${file}" || -L "${file}" ]]; then
    printf 'SQL input must be an absolute regular non-symlink file: %s\n' "${file}" >&2
    exit 2
  fi
  if grep -Eiq '(^|;)[[:space:]]*(begin[[:space:]]*;|start[[:space:]]+transaction[[:space:]]*;|commit[[:space:]]*;|end[[:space:]]+transaction[[:space:]]*;|rollback([[:space:]]+work)?[[:space:]]*;|abort[[:space:]]*;)' "${file}"; then
    printf 'SQL input contains transaction control and cannot be rollback-contained: %s\n' "${file}" >&2
    exit 2
  fi
done

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

canonical_dump_sha256() {
  docker exec -i "${container_name}" \
    pg_dump -U "${database_user}" -d "${database_name}" \
    --no-owner --no-privileges --no-comments --no-security-labels \
    | sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' \
    | sha256_stream
}

fixture_relation="$(target_psql -Atc "select to_regclass('wayfinder_rehearsal.fixture_cases')::text")"
if [[ "${fixture_relation}" != "wayfinder_rehearsal.fixture_cases" ]]; then
  printf '%s\n' 'Target database does not contain the Wayfinder #671 fixture registry.' >&2
  exit 1
fi
fixture_cases="$(target_psql -Atc 'select count(*) from wayfinder_rehearsal.fixture_cases')"
if [[ "${fixture_cases}" != "10" ]]; then
  printf '%s\n' 'Target database does not contain the complete Wayfinder #671 fixture.' >&2
  exit 1
fi

before_sha256="$(canonical_dump_sha256)"

{
  printf '%s\n' '\set ON_ERROR_STOP on' 'begin;'
  sed 's/\r$//' "${migration_file}"
  printf '\n%s\n' '\echo __WISEEFF_WAYFINDER_671_VALIDATION__'
  sed 's/\r$//' "${validation_file}"
  printf '\n%s\n' 'rollback;'
} | target_psql

after_sha256="$(canonical_dump_sha256)"
if [[ "${before_sha256}" != "${after_sha256}" ]]; then
  printf '%s\n' 'Rollback verification failed: canonical database dump changed.' >&2
  printf 'before_sha256=%s\nafter_sha256=%s\n' "${before_sha256}" "${after_sha256}" >&2
  exit 1
fi

printf '%s\n' \
  'REHEARSAL_ROLLBACK_OK' \
  "target_database=${database_name}" \
  "before_sha256=${before_sha256}" \
  "after_sha256=${after_sha256}" \
  "fixture_cases=${fixture_cases}"
