# @hollware/react

Read [Hollware](https://hollware.com) from any React app: server helpers that turn a `Request` into
a published entry (and into a draft, for the visitor of a preview link), and `<HollwareContent>`,
which renders an entry's Comark document with your own React components. It knows no framework: it
works the same in a React Router loader, a Next.js Server Component or a TanStack Start server
function, and it imports nothing of Cloudflare.

```sh
npm install @hollware/react
```

On Cloudflare, bind the Hollware Worker in the site's `wrangler.jsonc`:

```jsonc
"services": [{ "binding": "HOLLWARE", "service": "my-hollware", "entrypoint": "Hollware" }]
```

## React Router

```tsx
// app/hollware.server.ts: the `.server` suffix keeps the binding out of the browser's bundle
import { env } from 'cloudflare:workers'
import { createHollware, hollwareBinding } from '@hollware/react'
export const hollware = createHollware({
  site: 'my-site',
  reader: () => hollwareBinding(env.HOLLWARE),
})

// app/root.tsx: the link of a preview is exchanged for a cookie, with a 303
export const middleware = [
  ({ request }) => {
    const r = previewRedirect(request)
    if (r) throw r
  },
]
export const headers = ({ errorHeaders }: HeadersArgs) => errorHeaders

// app/routes/post.tsx
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const answer = await hollware.getEntry('blog', 'en', params.slug!, { request })
    if (!answer) throw data('Not found', { status: 404, headers: previewHeaders(request) })
    return data(
      { entry: answer.entry },
      { headers: answer.preview ? previewHeaders(request) : undefined },
    )
  } catch (error) {
    // a refused token: 404, and the cookie is cleared
    const headers = previewHeaders(request, error)
    throw headers.has('set-cookie') ? data('Not found', { status: 404, headers }) : error
  }
}
export default function Post() {
  const { entry } = useLoaderData<typeof loader>()
  return <HollwareContent entry={entry} components={{ Callout }} />
}
```

`examples/react-router-blog` is the whole site, and `apps/playground/test/harness/react-router-site.test.ts`
builds it and reads the playground.

## Next.js

```tsx
// middleware.ts: export const middleware = (req: NextRequest) => previewRedirect(req) ?? NextResponse.next()
// app/blog/[slug]/page.tsx, a Server Component: the cookie makes the page dynamic, so it is not kept
const hollware = createHollware({ site: 'my-site', url: HOLLWARE_URL, token: HOLLWARE_TOKEN })
const preview = (await cookies()).get(PREVIEW_COOKIE)?.value
const answer = await hollware.getEntry('blog', 'en', (await params).slug, { preview })
return answer ? <HollwareContent entry={answer.entry} components={{ Callout }} /> : notFound()
```

## The server helpers

| What                                        | Does                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `createHollware({ site, reader })`          | The read side of a site. `reader` is a service binding, or a function that gives it                  |
| `createHollware({ site, url, token })`      | The same over HTTP, with a read token (`hollware token create --read`)                               |
| `getEntry(collection, locale, slug, opts?)` | `{ entry, preview }`, or `undefined` when there is none; `opts.request` reads the preview cookie     |
| `listEntries(collection, opts?)`            | `{ entries, nextCursor }` of published entries, newest first (`locale`, `tag`, `limit`, `cursor`)    |
| `getTranslations(collection, group)`        | The `{ locale, slug }` of each entry of a translation group                                          |
| `hollwareBinding(env.HOLLWARE)`             | The service binding as a reader, with a clear error when it is missing                               |
| `previewRedirect(request)`                  | The `303` that exchanges a preview link for a cookie, or `null`                                      |
| `previewHeaders(request, error?)`           | `Cache-Control: no-store` for a visitor with a token, and the `Set-Cookie` that clears a refused one |
| `previewCookieClear(error, request)`        | That `Set-Cookie`, or `null` when `error` is no refusal of the token                                 |
| `<HollwareContent entry components />`      | Renders the entry's document on the server and hydrates it in the browser                            |

An entry is what a reader sees: its frontmatter, tags, dates and Comark `document`. Its verdict, its
revision and its last publication stay on the server, because a framework that renders on the server
sends a loader's data to the browser.

## Components

`<HollwareContent>` renders the Comark document Hollware stored when the entry was written, with
`@comark/react`. `components` maps the names of the components in the entry (`::callout` is
`Callout`) to your own; an element with no mapping renders as the plain tag. The page needs no
Markdown parser: the document is already parsed.

## Previews

"Preview on the site" in the admin opens the entry's page with `?hollware-preview=<token>`: a signed
link for one entry, valid for one hour. `previewRedirect` answers it with a `303` to the same URL
without the parameter and the token in the `hollware_preview` cookie (`HttpOnly`, `SameSite=Lax`,
an hour, `Secure` but on `http://localhost`). `getEntry({ request })` then reads the latest revision
of that entry, a draft included, and the answer has `preview: true`: the page must not be kept, so
send it `previewHeaders(request)`. A token that is expired or not valid is an error from `getEntry`,
never the published version; `previewHeaders(request, error)` clears the cookie for it. A token for
another entry is answered as no entry.

There is no hook for the browser: it would need a read token there and CORS on Hollware, and
published content is already in the page the server sent.
