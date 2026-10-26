export function indexAfterReload(
  chosen: string | null,
  previous: number,
  ids: readonly string[],
): number {
  const kept = chosen === null ? -1 : ids.indexOf(chosen)
  return kept >= 0 ? kept : Math.min(previous, ids.length - 1)
}
