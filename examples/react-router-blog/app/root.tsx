import { previewRedirect } from '@hollware/react'
import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  type HeadersArgs,
  type MiddlewareFunction,
} from 'react-router'

export const middleware: MiddlewareFunction<Response>[] = [
  ({ request }) => {
    const exchange = previewRedirect(request)
    if (exchange !== null) throw exchange
  },
]

export function headers({ errorHeaders }: HeadersArgs) {
  return errorHeaders
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="generator" content="Hollware" />
        <Meta />
        <Links />
      </head>
      <body>
        <header>
          <Link to="/">Blog</Link>
        </header>
        <main>{children}</main>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  return (
    <>
      <title>{notFound ? 'Not found' : 'Error'}</title>
      <h1>{notFound ? 'Not found' : 'Something went wrong'}</h1>
    </>
  )
}
