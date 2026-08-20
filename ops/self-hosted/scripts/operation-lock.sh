#!/usr/bin/env bash
# Shared host-level lock for setup and upgrade mutations.

wiseeff_operation_lock_owner_file() {
  printf '%s.owner\n' "$1"
}

wiseeff_operation_lock_validate_paths() {
  local lock_root="$1"
  local lock_path="${lock_root}/.operation.lock"
  local owner_file
  local lock_dir="${lock_root}/.operation.lock.d"
  owner_file="$(wiseeff_operation_lock_owner_file "$lock_path")"
  local path
  for path in "$lock_root" "$lock_path" "$owner_file" "$lock_dir" "${lock_dir}/pid" "${lock_dir}/owner"; do
    if [ -L "$path" ]; then
      printf 'WiseEff host lock paths must not be symlinks: %s\n' "$path" >&2
      return 10
    fi
  done
}

wiseeff_operation_lock_print_owner() {
  local owner_file="$1"
  if [ -r "$owner_file" ]; then
    sed -n '/^pid=/p;/^user=/p;/^operation=/p;/^started_at=/p' "$owner_file"
  fi
}

wiseeff_operation_lock_write_owner() {
  local owner_file="$1"
  local operation="$2"
  local temp_file
  operation="${operation//$'\n'/ }"
  operation="${operation//$'\r'/ }"
  umask 077
  temp_file="$(mktemp "${owner_file}.tmp.XXXXXX")" || return 10
  if ! {
    printf 'pid=%s\n' "$$"
    printf 'user=%s\n' "$(id -un 2>/dev/null || printf unknown)"
    printf 'operation=%s\n' "$operation"
    printf 'started_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$temp_file"; then
    rm -f "$temp_file" 2>/dev/null || true
    return 10
  fi
  chmod 600 "$temp_file" || { rm -f "$temp_file" 2>/dev/null || true; return 10; }
  mv -f "$temp_file" "$owner_file" || { rm -f "$temp_file" 2>/dev/null || true; return 10; }
}

wiseeff_operation_lock_pid_is_live() {
  local pid="$1"
  local error=""
  [ -d "/proc/${pid}" ] && return 0
  kill -0 "$pid" 2>/dev/null && return 0
  error="$(LC_ALL=C kill -0 "$pid" 2>&1 || true)"
  case "$error" in
    *"Operation not permitted"*) return 0 ;;
  esac
  return 1
}

wiseeff_operation_lock_fallback_is_old() {
  local lock_dir="$1"
  local mtime now grace
  mtime="$(stat -c '%Y' "$lock_dir" 2>/dev/null || stat -f '%m' "$lock_dir" 2>/dev/null || true)"
  case "$mtime" in
    ''|*[!0-9]*) return 1 ;;
  esac
  now="$(date +%s)" || return 1
  grace="${WISEEFF_OPERATION_LOCK_STALE_GRACE_SECONDS:-300}"
  case "$grace" in
    ''|*[!0-9]*) grace=300 ;;
  esac
  [ $((now - mtime)) -ge "$grace" ]
}

wiseeff_operation_lock_acquire() {
  local lock_root="${1:?lock root is required}"
  local message="${2:-Another WiseEff operation holds the host lock.}"
  local operation="${3:-wiseeff-operation}"
  wiseeff_operation_lock_validate_paths "$lock_root" || return $?
  mkdir -p "$lock_root" || return 10
  wiseeff_operation_lock_validate_paths "$lock_root" || return $?
  chmod 700 "$lock_root" || {
    printf 'Cannot secure WiseEff host lock root: %s. Run the one-time prepare-host action or fix its ownership.\n' "$lock_root" >&2
    return 10
  }
  operation_lock_path="${lock_root}/.operation.lock"
  operation_lock_owner_path="$(wiseeff_operation_lock_owner_file "$operation_lock_path")"

  if command -v flock >/dev/null 2>&1; then
    operation_lock_fd=9
    if ! exec 9<>"$operation_lock_path"; then
      printf 'Cannot open WiseEff host lock: %s\n' "$operation_lock_path" >&2
      return 10
    fi
    if ! flock -n 9; then
      printf '%s\n' "$message" >&2
      wiseeff_operation_lock_print_owner "$operation_lock_owner_path" >&2
      exec 9>&- 2>/dev/null || true
      return 75
    fi
    operation_lock_mode="flock"
    chmod 600 "$operation_lock_path" || {
      flock -u 9 2>/dev/null || true
      exec 9>&- 2>/dev/null || true
      operation_lock_mode=""
      return 10
    }
    wiseeff_operation_lock_write_owner "$operation_lock_owner_path" "$operation" || {
      flock -u 9 2>/dev/null || true
      exec 9>&- 2>/dev/null || true
      operation_lock_mode=""
      return 10
    }
    return 0
  fi

  operation_lock_dir="${lock_root}/.operation.lock.d"
  if ! mkdir "$operation_lock_dir" 2>/dev/null; then
    if wiseeff_operation_lock_clear_stale "$lock_root" >/dev/null 2>&1 && mkdir "$operation_lock_dir" 2>/dev/null; then
      printf 'Recovered a proven-stale WiseEff fallback host lock.\n' >&2
    else
      printf '%s\n' "$message" >&2
      wiseeff_operation_lock_print_owner "${operation_lock_dir}/owner" >&2
      return 75
    fi
  fi
  printf '%s\n' "$$" > "${operation_lock_dir}/pid" || {
    rmdir "$operation_lock_dir" 2>/dev/null || true
    return 10
  }
  chmod 600 "${operation_lock_dir}/pid" || {
    rm -f "${operation_lock_dir}/pid" 2>/dev/null || true
    rmdir "$operation_lock_dir" 2>/dev/null || true
    return 10
  }
  operation_lock_owner_path="${operation_lock_dir}/owner"
  wiseeff_operation_lock_write_owner "$operation_lock_owner_path" "$operation" || {
    rm -f "${operation_lock_dir}/pid" 2>/dev/null || true
    rmdir "$operation_lock_dir" 2>/dev/null || true
    return 10
  }
  operation_lock_mode="mkdir"
}

wiseeff_operation_lock_release() {
  local owner_pid=""
  if [ -n "${operation_lock_owner_path:-}" ] && [ -r "$operation_lock_owner_path" ]; then
    owner_pid="$(awk -F= '$1 == "pid" { print $2; exit }' "$operation_lock_owner_path" 2>/dev/null || true)"
  fi
  if [ "$owner_pid" = "$$" ]; then
    rm -f "$operation_lock_owner_path" 2>/dev/null || true
  fi

  if [ "${operation_lock_mode:-}" = "flock" ]; then
    flock -u 9 2>/dev/null || true
    exec 9>&- 2>/dev/null || true
  elif [ "${operation_lock_mode:-}" = "mkdir" ] && [ -n "${operation_lock_dir:-}" ]; then
    rm -f "${operation_lock_dir}/pid" 2>/dev/null || true
    rmdir "$operation_lock_dir" 2>/dev/null || true
  fi
  operation_lock_mode=""
  operation_lock_owner_path=""
}

wiseeff_operation_lock_status() {
  local lock_root="${1:?lock root is required}"
  local lock_path="${lock_root}/.operation.lock"
  local owner_file
  owner_file="$(wiseeff_operation_lock_owner_file "$lock_path")"
  wiseeff_operation_lock_validate_paths "$lock_root" || return $?

  if command -v flock >/dev/null 2>&1; then
    printf 'lock_mode=flock\nlock_path=%s\n' "$lock_path"
    if [ ! -e "$lock_path" ]; then
      printf 'lock_state=free\n'
      if [ -e "$owner_file" ]; then
        printf 'stale_metadata=%s\n' "$owner_file"
      fi
      return 0
    fi
    if ! exec 8<>"$lock_path"; then
      printf 'lock_state=inaccessible\n' >&2
      return 10
    fi
    if flock -n 8; then
      printf 'lock_state=free\n'
      if [ -e "$owner_file" ]; then
        printf 'stale_metadata=%s\n' "$owner_file"
      fi
      flock -u 8 2>/dev/null || true
      exec 8>&- 2>/dev/null || true
      return 0
    fi
    printf 'lock_state=held\n'
    wiseeff_operation_lock_print_owner "$owner_file"
    exec 8>&- 2>/dev/null || true
    return 75
  fi

  local lock_dir="${lock_root}/.operation.lock.d"
  local pid=""
  printf 'lock_mode=mkdir\nlock_path=%s\n' "$lock_dir"
  if [ ! -d "$lock_dir" ]; then
    printf 'lock_state=free\n'
    if [ -e "$owner_file" ]; then
      printf 'stale_metadata=%s\n' "$owner_file"
    fi
    return 0
  fi
  pid="$(sed -n '1p' "${lock_dir}/pid" 2>/dev/null || true)"
  case "$pid" in
    ''|*[!0-9]*|0)
      if ! wiseeff_operation_lock_fallback_is_old "$lock_dir"; then
        printf 'lock_state=initializing\n'
        wiseeff_operation_lock_print_owner "${lock_dir}/owner"
        return 75
      fi
      printf 'lock_state=stale\n'
      wiseeff_operation_lock_print_owner "${lock_dir}/owner"
      return 0
      ;;
  esac
  if wiseeff_operation_lock_pid_is_live "$pid"; then
    printf 'lock_state=held\n'
    wiseeff_operation_lock_print_owner "${lock_dir}/owner"
    return 75
  fi
  printf 'lock_state=stale\n'
  wiseeff_operation_lock_print_owner "${lock_dir}/owner"
}

wiseeff_operation_lock_clear_stale() {
  local lock_root="${1:?lock root is required}"
  local lock_path="${lock_root}/.operation.lock"
  local owner_file
  owner_file="$(wiseeff_operation_lock_owner_file "$lock_path")"
  wiseeff_operation_lock_validate_paths "$lock_root" || return $?

  if command -v flock >/dev/null 2>&1; then
    if [ ! -e "$lock_path" ]; then
      if [ -e "$owner_file" ]; then
        rm -f "$owner_file" || return 10
        printf 'WiseEff host lock is free; stale owner metadata was cleared.\n'
      else
        printf 'WiseEff host lock is already free.\n'
      fi
      return 0
    fi
    if ! exec 8<>"$lock_path"; then
      printf 'Cannot inspect WiseEff host lock: %s\n' "$lock_path" >&2
      return 10
    fi
    if ! flock -n 8; then
      printf 'Refusing to unlock a live WiseEff host operation.\n' >&2
      wiseeff_operation_lock_print_owner "$owner_file" >&2
      exec 8>&- 2>/dev/null || true
      return 75
    fi
    if ! rm -f "$owner_file"; then
      flock -u 8 2>/dev/null || true
      exec 8>&- 2>/dev/null || true
      return 10
    fi
    flock -u 8 2>/dev/null || true
    exec 8>&- 2>/dev/null || true
    printf 'WiseEff host lock is free; stale owner metadata was cleared.\n'
    return 0
  fi

  local lock_dir="${lock_root}/.operation.lock.d"
  local pid=""
  local stale_dir
  if [ ! -d "$lock_dir" ]; then
    if [ -e "$owner_file" ]; then
      rm -f "$owner_file" || return 10
      printf 'WiseEff host lock is free; stale owner metadata was cleared.\n'
    else
      printf 'WiseEff host lock is already free.\n'
    fi
    return 0
  fi
  pid="$(sed -n '1p' "${lock_dir}/pid" 2>/dev/null || true)"
  case "$pid" in
    ''|*[!0-9]*|0)
      if ! wiseeff_operation_lock_fallback_is_old "$lock_dir"; then
        printf 'Refusing to unlock a recent fallback lock without conclusive owner metadata; retry after the stale-lock grace period.\n' >&2
        wiseeff_operation_lock_print_owner "${lock_dir}/owner" >&2
        return 75
      fi
      ;;
    *)
      if wiseeff_operation_lock_pid_is_live "$pid"; then
        printf 'Refusing to unlock a live WiseEff host operation.\n' >&2
        wiseeff_operation_lock_print_owner "${lock_dir}/owner" >&2
        return 75
      fi
      ;;
  esac
  stale_dir="${lock_dir}.stale.$(date -u +%Y%m%dT%H%M%SZ).$$"
  mv "$lock_dir" "$stale_dir" || return 10
  printf 'Moved stale WiseEff host lock to %s\n' "$stale_dir"
}
