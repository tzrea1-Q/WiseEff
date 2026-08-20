#!/usr/bin/env bash
# Shared host-level lock for setup and upgrade mutations.

wiseeff_operation_lock_acquire() {
  local lock_root="${1:?lock root is required}"
  local message="${2:-Another WiseEff operation holds the host lock.}"
  mkdir -p "$lock_root"
  chmod 700 "$lock_root"
  operation_lock_path="${lock_root}/.operation.lock"

  if command -v flock >/dev/null 2>&1; then
    operation_lock_fd=9
    exec 9>"$operation_lock_path"
    if ! flock -n 9; then
      printf '%s\n' "$message" >&2
      return 75
    fi
    operation_lock_mode="flock"
    return 0
  fi

  operation_lock_dir="${lock_root}/.operation.lock.d"
  if ! mkdir "$operation_lock_dir" 2>/dev/null; then
    printf '%s\n' "$message" >&2
    return 75
  fi
  printf '%s\n' "$$" > "${operation_lock_dir}/pid"
  operation_lock_mode="mkdir"
}

wiseeff_operation_lock_release() {
  if [ "${operation_lock_mode:-}" = "flock" ]; then
    flock -u 9 2>/dev/null || true
    exec 9>&- 2>/dev/null || true
  elif [ "${operation_lock_mode:-}" = "mkdir" ] && [ -n "${operation_lock_dir:-}" ]; then
    rm -f "${operation_lock_dir}/pid" 2>/dev/null || true
    rmdir "$operation_lock_dir" 2>/dev/null || true
  fi
  operation_lock_mode=""
}
