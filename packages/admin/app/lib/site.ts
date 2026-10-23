export function pageUrl(
  siteUrl: string | null,
  routes: Readonly<Record<string, string>>,
  locale: string,
  slug: string,
): string | null {
  const route = routes[locale]
  if (siteUrl === null || route === undefined) return null
  return `${siteUrl.replace(/\/+$/, '')}${route.replace(/:slug(?![A-Za-z0-9_])/, slug)}`
}
