export interface SiteLink {
  readonly label: string
  readonly href: string
}

export interface SiteSettings {
  readonly title: string
  readonly navigation: readonly SiteLink[]
  readonly footer: { readonly tagline: string; readonly links: readonly SiteLink[] }
}

const NONE: SiteSettings = { title: 'Hollware', navigation: [], footer: { tagline: '', links: [] } }

const text = (value: unknown) => (typeof value === 'string' ? value : '')

function linksOf(value: unknown): SiteLink[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return []
    const { label, href } = item as Record<string, unknown>
    return typeof label === 'string' && typeof href === 'string' ? [{ label, href }] : []
  })
}

export function settingsOf(frontmatter: Record<string, unknown> | undefined): SiteSettings {
  if (frontmatter === undefined) return NONE
  const footer = frontmatter['footer']
  const foot =
    typeof footer === 'object' && footer !== null ? (footer as Record<string, unknown>) : {}
  return {
    title: text(frontmatter['title']) || NONE.title,
    navigation: linksOf(frontmatter['navigation']),
    footer: { tagline: text(foot['tagline']), links: linksOf(foot['links']) },
  }
}

export const isExternal = (href: string) => /^https?:\/\//.test(href)

export async function useSettings(): Promise<ComputedRef<SiteSettings>> {
  const { locale } = useLocale()
  const { data } = await useHollwareEntry('settings', locale, 'settings')
  return computed(() => settingsOf(data.value?.entry.frontmatter))
}
