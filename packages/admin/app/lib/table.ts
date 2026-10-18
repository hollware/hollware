/**
 * The rows a page of a table shows, counted from 1: the first and the last, of how many the filter
 * leaves. A table with no row left shows from 0 to 0.
 */
export function pageRange(
  pageIndex: number,
  pageSize: number,
  filtered: number,
): { readonly from: number; readonly to: number } {
  if (filtered === 0) return { from: 0, to: 0 }
  // A filter can leave fewer rows than the page it was on started at: show its last page.
  const lastPage = Math.max(0, Math.ceil(filtered / pageSize) - 1)
  const page = Math.min(pageIndex, lastPage)
  return { from: page * pageSize + 1, to: Math.min(filtered, (page + 1) * pageSize) }
}
