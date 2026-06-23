#!/usr/bin/env bash

WISEEFF_MIN_COMPOSE_V1_MAJOR=1
WISEEFF_MIN_COMPOSE_V1_MINOR=28
WISEEFF_MIN_COMPOSE_V1_PATCH=0

wiseeff_parse_compose_version() {
  local output="$1"
  local version_line
  version_line="$(printf '%s\n' "$output" | sed -n 's/.*[^0-9]\([0-9]\+\)\.\([0-9]\+\)\.\([0-9]\+\).*/\1 \2 \3/p' | head -1)"
  if [ -z "$version_line" ]; then
    return 1
  fi
  printf '%s\n' "$version_line"
}

wiseeff_compose_version_ok() {
  local major="$1"
  local minor="$2"
  local patch="$3"

  if [ "$major" -ge 2 ]; then
    return 0
  fi

  if [ "$major" -lt "$WISEEFF_MIN_COMPOSE_V1_MAJOR" ]; then
    return 1
  fi
  if [ "$major" -gt "$WISEEFF_MIN_COMPOSE_V1_MAJOR" ]; then
    return 0
  fi
  if [ "$minor" -gt "$WISEEFF_MIN_COMPOSE_V1_MINOR" ]; then
    return 0
  fi
  if [ "$minor" -lt "$WISEEFF_MIN_COMPOSE_V1_MINOR" ]; then
    return 1
  fi
  [ "$patch" -ge "$WISEEFF_MIN_COMPOSE_V1_PATCH" ]
}

wiseeff_compose_requirement_message() {
  printf 'Install docker compose (v2 plugin) or docker-compose %s.%s.%s+.\n' \
    "$WISEEFF_MIN_COMPOSE_V1_MAJOR" \
    "$WISEEFF_MIN_COMPOSE_V1_MINOR" \
    "$WISEEFF_MIN_COMPOSE_V1_PATCH"
}

wiseeff_compose_exec() {
  local compose_dir="$1"
  local compose_file="$2"
  shift 2

  cd "$compose_dir"

  if docker compose version >/dev/null 2>&1; then
    local version_output version_parts major minor patch
    version_output="$(docker compose version 2>/dev/null || true)"
    version_parts="$(wiseeff_parse_compose_version "$version_output" || true)"
    if [ -n "$version_parts" ]; then
      read -r major minor patch <<< "$version_parts"
      if ! wiseeff_compose_version_ok "$major" "$minor" "$patch"; then
        echo "Docker Compose ${major}.${minor}.${patch} is too old." >&2
        wiseeff_compose_requirement_message >&2
        exit 1
      fi
    fi
    exec docker compose "$@"
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    local version_output version_parts major minor patch
    version_output="$(docker-compose version 2>/dev/null || docker-compose --version 2>/dev/null || true)"
    version_parts="$(wiseeff_parse_compose_version "$version_output" || true)"
    if [ -z "$version_parts" ]; then
      echo "Could not determine docker-compose version." >&2
      wiseeff_compose_requirement_message >&2
      exit 1
    fi
    read -r major minor patch <<< "$version_parts"
    if ! wiseeff_compose_version_ok "$major" "$minor" "$patch"; then
      echo "docker-compose ${major}.${minor}.${patch} is too old." >&2
      wiseeff_compose_requirement_message >&2
      exit 1
    fi
    exec docker-compose -f "$compose_file" "$@"
  fi

  echo "Neither 'docker compose' nor 'docker-compose' is available." >&2
  wiseeff_compose_requirement_message >&2
  exit 127
}
