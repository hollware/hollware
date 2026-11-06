import type { NavigationEntry } from '@hollware/client'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { HollwareBreadcrumbs, HollwareTree } from '../src/index.ts'

function page(
  slug: string,
  path: string | null,
  children: NavigationEntry[] = [],
  parent: string | null = null,
): NavigationEntry {
  return { slug, title: slug, description: null, path, order: null, parent, children }
}

const groups = [
  {
    name: null,
    entries: [
      page('cuenta', '/ayuda/cuenta/'),
      page('facturacion', '/ayuda/facturacion/', [
        page('pagos', '/ayuda/facturacion/pagos/', [], 'facturacion'),
      ]),
    ],
  },
]

describe('<HollwareTree>', () => {
  it('nests the children, opens the branch of the page shown and marks it current', () => {
    const html = renderToString(<HollwareTree groups={groups} current="pagos" />)

    expect(html).toBe(
      '<nav aria-label="Pages"><section><ul>' +
        '<li><a href="/ayuda/cuenta/">cuenta</a></li>' +
        '<li><details open=""><summary><a href="/ayuda/facturacion/">facturacion</a></summary>' +
        '<ul><li><a href="/ayuda/facturacion/pagos/" aria-current="page">pagos</a></li></ul>' +
        '</details></li></ul></section></nav>',
    )
  })

  it('keeps a branch closed when the page is not in it, and renders links with the component given', () => {
    function Link(props: { href: string; children?: React.ReactNode }) {
      return (
        <a data-router="" href={props.href}>
          {props.children}
        </a>
      )
    }
    const html = renderToString(<HollwareTree groups={groups} current="cuenta" link={Link} />)

    expect(html).toContain('<details><summary><a data-router="" href="/ayuda/facturacion/">')
    expect(html).toContain('<a data-router="" href="/ayuda/cuenta/">cuenta</a>')
  })
})

describe('<HollwareBreadcrumbs>', () => {
  it('links the ancestors from the root down, and ends with the title of the page', () => {
    const html = renderToString(
      <HollwareBreadcrumbs
        ancestors={[{ slug: 'facturacion', title: 'Facturación', path: '/ayuda/facturacion/' }]}
        title="Pagos"
      />,
    )

    expect(html).toBe(
      '<nav aria-label="Breadcrumbs"><ol><li><a href="/ayuda/facturacion/">Facturación</a></li>' +
        '<li><span aria-current="page">Pagos</span></li></ol></nav>',
    )
  })
})
