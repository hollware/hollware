import { HollwareContent, previewHeaders } from '@hollware/react'
import { data, useLoaderData, type HeadersArgs, type LoaderFunctionArgs } from 'react-router'
import { hollware } from '../hollware.server.ts'
import { Callout } from '../callout.tsx'

// root.tsx exchanged the link of the admin's "Preview on the site" for a cookie: `getEntry` reads
// the token from the request, so the latest revision of its entry, a draft included, is served,
// and the page must not be kept (`answer.preview`). A token that expired or is not valid is
// refused by Hollware: the 404 clears the cookie. A token for another entry is answered as no
// entry, and is no refusal.
export async function loader({ request, params }: LoaderFunctionArgs) {
  let answer
  try {
    answer = await hollware.getEntry('blog', 'en', params['slug'] ?? '', { request })
  } catch (error) {
    const headers = previewHeaders(request, error)
    // Anything but Hollware's refusal of the token is a failure of the site.
    if (!headers.has('set-cookie')) throw error
    throw data('Not found', { status: 404, headers })
  }
  if (answer === undefined) {
    throw data('Not found', { status: 404, headers: previewHeaders(request) })
  }
  const { entry } = answer
  const { title } = entry.frontmatter
  const headers = answer.preview ? previewHeaders(request) : undefined
  return data({ entry, title: typeof title === 'string' ? title : entry.slug }, { headers })
}

// The headers of the loader, `no-store` for a preview, reach the document only through this. The
// ones of a 404 are the root's to forward, as its ErrorBoundary is the one that renders it.
export function headers({ loaderHeaders }: HeadersArgs) {
  return loaderHeaders
}

export function meta({ loaderData }: { loaderData?: { title: string } }) {
  return [{ title: loaderData?.title ?? 'Not found' }]
}

export default function Post() {
  const { entry, title } = useLoaderData<typeof loader>()
  return (
    <article>
      <h1>{title}</h1>
      <HollwareContent entry={entry} components={{ Callout }} />
    </article>
  )
}
