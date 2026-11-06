import type { NavigationEntry, NavigationGroup, PageAncestor } from '@hollware/client'
import type { ComponentType, ReactElement, ReactNode } from 'react'

/** What renders a link of the tree or the breadcrumbs: `<a>`, or the `Link` of a router. */
export type HollwareLinkComponent = ComponentType<{
  readonly href: string
  readonly children?: ReactNode
  readonly 'aria-current'?: 'page'
}>

function Anchor(props: {
  readonly href: string
  readonly children?: ReactNode
  readonly 'aria-current'?: 'page'
}): ReactElement {
  return <a {...props} />
}

/** What `<HollwareTree>` takes: the groups of a navigation, and the slug of the page shown. */
export interface HollwareTreeProps {
  /** The `groups` of `getNavigation`. */
  readonly groups: readonly NavigationGroup[]
  /** The slug of the entry the page shows: it is marked `aria-current`, and its branch is open. */
  readonly current?: string
  /** How a link renders, such as the `Link` of React Router; `<a>` when not given. */
  readonly link?: HollwareLinkComponent
  /** The heading of a group, by its name; groups have none when not given. */
  readonly heading?: (name: string | null) => ReactNode
  readonly className?: string
  /** The label of the `<nav>`, for a screen reader. */
  readonly label?: string
}

function holds(entry: NavigationEntry, slug: string | undefined): boolean {
  return (
    slug !== undefined &&
    (entry.slug === slug || entry.children.some((child) => holds(child, slug)))
  )
}

function Branch(props: {
  readonly entries: readonly NavigationEntry[]
  readonly current: string | undefined
  readonly link: HollwareLinkComponent
}): ReactElement {
  const Link = props.link
  return (
    <ul>
      {props.entries.map((entry) => {
        const here = entry.slug === props.current
        const label =
          entry.path === null ? (
            <span>{entry.title}</span>
          ) : (
            <Link href={entry.path} {...(here ? { 'aria-current': 'page' as const } : {})}>
              {entry.title}
            </Link>
          )
        if (entry.children.length === 0) return <li key={entry.slug}>{label}</li>
        return (
          <li key={entry.slug}>
            <details open={holds(entry, props.current)}>
              <summary>{label}</summary>
              <Branch entries={entry.children} current={props.current} link={props.link} />
            </details>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The sidebar of a nested collection, as `getNavigation` gives it: a list in a `<nav>`, each entry
 * with children in a `<details>` that is open on the branch of the page shown, which is marked
 * `aria-current="page"`. It has no styles of its own: style it by its elements.
 */
export function HollwareTree({
  groups,
  current,
  link = Anchor,
  heading,
  className,
  label = 'Pages',
}: HollwareTreeProps): ReactElement {
  return (
    <nav aria-label={label} className={className}>
      {groups.map((group) => (
        <section key={group.name ?? ''}>
          {heading === undefined ? null : heading(group.name)}
          <Branch entries={group.entries} current={current} link={link} />
        </section>
      ))}
    </nav>
  )
}

/** What `<HollwareBreadcrumbs>` takes: the ancestors of an entry, and its title. */
export interface HollwareBreadcrumbsProps {
  /** The `ancestors` of `getPage` or `getEntry`, from the root down. */
  readonly ancestors: readonly PageAncestor[]
  /** The title of the entry the page shows, last and not a link. */
  readonly title: string
  readonly link?: HollwareLinkComponent
  readonly className?: string
  readonly label?: string
}

/**
 * The breadcrumbs of a nested entry: its ancestors as links, from the root down, and its own title
 * marked `aria-current="page"`, in an ordered list in a `<nav>`.
 */
export function HollwareBreadcrumbs({
  ancestors,
  title,
  link: Link = Anchor,
  className,
  label = 'Breadcrumbs',
}: HollwareBreadcrumbsProps): ReactElement {
  return (
    <nav aria-label={label} className={className}>
      <ol>
        {ancestors.map((ancestor) => (
          <li key={ancestor.slug}>
            {ancestor.path === null ? (
              <span>{ancestor.title}</span>
            ) : (
              <Link href={ancestor.path}>{ancestor.title}</Link>
            )}
          </li>
        ))}
        <li>
          <span aria-current="page">{title}</span>
        </li>
      </ol>
    </nav>
  )
}
