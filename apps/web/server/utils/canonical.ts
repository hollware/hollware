const FILE = /\/[^/]*\.[^/]*$/

export function canonicalRedirectOf(url: URL): string | null {
  const target = new URL(url)
  if (target.hostname.startsWith('www.')) target.hostname = target.hostname.slice('www.'.length)
  const internal = target.pathname.split('/').some((segment) => segment.startsWith('_'))
  if (!internal && !target.pathname.endsWith('/') && !FILE.test(target.pathname)) {
    target.pathname = `${target.pathname}/`
  }
  const canonical = target.toString()
  return canonical === url.toString() ? null : canonical
}
