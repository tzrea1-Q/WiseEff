export function shouldShowFieldError(
  error: string | null | undefined,
  options: { touched?: boolean; submitted?: boolean } = {}
): boolean {
  return Boolean(error && (options.touched || options.submitted));
}
