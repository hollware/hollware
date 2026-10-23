export function pageRange(
  pageIndex: number,
  pageSize: number,
  filtered: number,
): { readonly from: number; readonly to: number } {
  if (filtered === 0) return { from: 0, to: 0 }
  const lastPage = Math.max(0, Math.ceil(filtered / pageSize) - 1)
  const page = Math.min(pageIndex, lastPage)
  return { from: page * pageSize + 1, to: Math.min(filtered, (page + 1) * pageSize) }
}
