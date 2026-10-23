import { HollwareContent, previewHeaders } from '@hollware/react'
import { data, useLoaderData, type HeadersArgs, type LoaderFunctionArgs } from 'react-router'
import { hollware } from '../hollware.server.ts'
import { Callout } from '../callout.tsx'

export async function loader({ request, params }: LoaderFunctionArgs) {
  let answer
  try {
    answer = await hollware.getEntry('blog', 'en', params['slug'] ?? '', { request })
  } catch (error) {
    const headers = previewHeaders(request, error)
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
