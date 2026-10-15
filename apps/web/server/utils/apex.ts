/** The same URL on the apex when it is on www, or `null` when it is on the apex already. */
export function apexOf(url: URL): string | null {
  if (!url.hostname.startsWith('www.')) return null
  const apex = new URL(url)
  apex.hostname = url.hostname.slice('www.'.length)
  return apex.toString()
}
