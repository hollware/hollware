import {
  flattenNavigation,
  HollwareBreadcrumbs,
  HollwareContent,
  HollwareTree,
  previewHeaders,
} from '@hollware/react'
import {
  data,
  Link,
  redirect,
  useLoaderData,
  type HeadersArgs,
  type LoaderFunctionArgs,
} from 'react-router'
import { hollware } from '../hollware.server.ts'

function RouterLink({ href, ...rest }: { href: string; children?: React.ReactNode }) {
  return <Link to={href} {...rest} />
}

export async function loader({ request }: LoaderFunctionArgs) {
  let page
  try {
    page = await hollware.getPage(new URL(request.url).pathname, { request })
  } catch (error) {
    const headers = previewHeaders(request, error)
    if (!headers.has('set-cookie')) throw error
    throw data('Not found', { status: 404, headers })
  }
  if (page.outcome === 'redirect') throw redirect(page.path, 301)
  if (page.outcome === 'not_found') {
    throw data('Not found', { status: 404, headers: previewHeaders(request) })
  }
  const { entry } = page
  const navigation = await hollware.getNavigation('help', { locale: entry.locale })
  const flat = flattenNavigation(navigation)
  const at = flat.findIndex((one) => one.slug === entry.slug)
  const { title } = entry.frontmatter
  return data(
    {
      entry,
      title: typeof title === 'string' ? title : entry.slug,
      ancestors: page.ancestors ?? [],
      groups: navigation.groups,
      previous: at > 0 ? (flat[at - 1] ?? null) : null,
      next: at === -1 ? null : (flat[at + 1] ?? null),
    },
    { headers: page.preview ? previewHeaders(request) : undefined },
  )
}

export function headers({ loaderHeaders }: HeadersArgs) {
  return loaderHeaders
}

export function meta({ loaderData }: { loaderData?: { title: string } }) {
  return [{ title: loaderData?.title ?? 'Not found' }]
}

export default function Help() {
  const { entry, title, ancestors, groups, previous, next } = useLoaderData<typeof loader>()
  return (
    <div className="help">
      <HollwareTree groups={groups} current={entry.slug} link={RouterLink} label="Help" />
      <article>
        <HollwareBreadcrumbs ancestors={ancestors} title={title} link={RouterLink} />
        <h1>{title}</h1>
        <HollwareContent entry={entry} />
        <nav aria-label="Pages">
          {previous?.path ? <Link to={previous.path}>← {previous.title}</Link> : null}
          {next?.path ? <Link to={next.path}>{next.title} →</Link> : null}
        </nav>
      </article>
    </div>
  )
}
