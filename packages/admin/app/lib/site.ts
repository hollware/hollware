/** The public URL of an entry: the site's origin and its collection's route with the slug. */
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
