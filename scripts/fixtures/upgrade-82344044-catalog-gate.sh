wiseeff_upgrade_verify_parameter_catalog() {
  if wiseeff_upgrade_compose exec -T api npm run parameter-definitions:check -- --catalog-only; then
    return 0
  fi
  wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" api candidate-parameter-catalog "The canonical driver parameter catalog verification gate is blocked."
  return 1
}
