export function errorMessage(
  error: unknown,
  fallback = "Не удалось выполнить действие. Попробуйте ещё раз.",
) {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/^Error:\s*/, "")
    .trim();
  return /[А-Яа-яЁё]/.test(message) ? message : fallback;
}
