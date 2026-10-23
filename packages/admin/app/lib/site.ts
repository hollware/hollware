export function pageUrl(
  siteUrl: string | null,
  routes: Readonly<Record<string, string>>,
  locale: string,
  slug: string,
): string | null {
  const route = routes[locale]
  if (siteUrl === null || route === undefined) return null
  return `${withoutTrailingSlashes(siteUrl)}${route.replace(/:slug(?![A-Za-z0-9_])/, slug)}`
}

function withoutTrailingSlashes(text: string): string {
  let end = text.length
  while (end > 0 && text[end - 1] === '/') end--
  return text.slice(0, end)
}
